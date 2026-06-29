import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { FixedSizeList } from 'react-window';
import Hls from 'hls.js';
import { useConfig } from '../hooks/useConfig';
import { useBookmarks } from '../hooks/useBookmarks';
import { useEpg, fmtTime, epgProgress, clearNowCache } from '../hooks/useEpg';
import { getChannelCache, setChannelCache } from '../hooks/useChannels';
import MediaCard from '../components/common/MediaCard';
import EpgGrid from '../components/epg/EpgGrid.jsx';

const DEMO_CHANNELS = [
  { id: 'c1', name: 'BBC News', group: 'News', logo: null, url: '' },
  { id: 'c2', name: 'CNN International', group: 'News', logo: null, url: '' },
  { id: 'c3', name: 'Al Jazeera', group: 'News', logo: null, url: '' },
  { id: 'c4', name: 'ESPN', group: 'Sports', logo: null, url: '' },
  { id: 'c5', name: 'Sky Sports', group: 'Sports', logo: null, url: '' },
  { id: 'c6', name: 'beIN Sports', group: 'Sports', logo: null, url: '' },
  { id: 'c7', name: 'HBO', group: 'Entertainment', logo: null, url: '' },
  { id: 'c8', name: 'AMC', group: 'Entertainment', logo: null, url: '' },
  { id: 'c9', name: 'Discovery', group: 'Documentary', logo: null, url: '' },
  { id: 'c10', name: 'National Geographic', group: 'Documentary', logo: null, url: '' },
];

function parseM3U(text) {
  const lines = text.split('\n');
  const channels = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF:')) {
      const nameMatch = trimmed.match(/,(.+)$/);
      const groupMatch = trimmed.match(/group-title="([^"]*?)"/);
      const logoMatch = trimmed.match(/tvg-logo="([^"]*?)"/);
      const epgIdMatch = trimmed.match(/tvg-id="([^"]*?)"/);
      current = {
        id: `m3u_${channels.length}`,
        name: nameMatch ? nameMatch[1].trim() : 'Unknown',
        group: groupMatch ? groupMatch[1] : 'Uncategorized',
        logo: logoMatch ? logoMatch[1] : null,
        epg_id: epgIdMatch ? epgIdMatch[1] : null,
        url: '',
      };
    } else if (trimmed && !trimmed.startsWith('#') && current) {
      current.url = trimmed;
      channels.push(current);
      current = null;
    }
  }
  return channels;
}

// ── Country detection helpers ─────────────────────────────────────────────
// Matches common IPTV prefixes: "DK: Channel", "DK | Channel", "DK - Channel", "[DK] Channel", "|DK| Channel", "DNK| Channel"
const COUNTRY_PREFIX_RE = /^(?:\[([A-Z]{2,3})\]|\|([A-Z]{2,3})\||([A-Z]{2,3})\s*[:|\-])/i;

// Map 3-letter IPTV codes → standard 2-letter ISO codes
const CODE_NORMALIZE = {
  DNK:'DK', SWE:'SE', NOR:'NO', FIN:'FI', ESP:'ES', USA:'US', CAN:'CA', MXC:'MX',
  ALB:'AL', ARG:'AR', ARA:'AE', ISR:'IL', CHN:'CN', ARM:'AM', AFG:'AF', UGA:'UG',
  GHA:'GH', SOM:'SO', SEN:'SN', CHL:'CL', TWN:'TW', ETH:'ET', NIG:'NG', CAM:'CM',
  LUX:'LU', TGK:'TJ', EST:'EE', MOZ:'MZ', TOG:'TG', MNG:'MN', SRI:'LK', BAN:'BD',
  NIC:'NI', RWA:'RW', ERI:'ER', GUI:'GN', ANG:'AO', GAM:'GM', BKF:'BF', TCH:'TD', COM:'KM',
  SLN:'SL',
};

function normalizeCode(raw) {
  const up = raw.toUpperCase();
  return CODE_NORMALIZE[up] || (up.length === 2 ? up : null);
}

function detectCountryCode(channel) {
  const nameMatch = channel.name.match(COUNTRY_PREFIX_RE);
  if (nameMatch) {
    const code = normalizeCode(nameMatch[1] || nameMatch[2] || nameMatch[3]);
    if (code) return code;
  }
  const groupMatch = channel.group?.match(COUNTRY_PREFIX_RE);
  if (groupMatch) {
    const code = normalizeCode(groupMatch[1] || groupMatch[2] || groupMatch[3]);
    if (code) return code;
  }
  return null;
}

function detectCategoryCountry(categoryName) {
  const m = categoryName.match(/^\|([A-Z]{2,3})\|\s*|^\[([A-Z]{2,3})\]\s*|^([A-Z]{2,3})\s*[:|\-]\s*/i);
  if (!m) return null;
  const raw = (m[1] || m[2] || m[3]).toUpperCase();
  return CODE_NORMALIZE[raw] || (raw.length === 2 ? raw : null);
}

// Country name lookup (common IPTV codes)
const COUNTRY_NAMES = {
  AF:'Afghanistan',AL:'Albania',DZ:'Algeria',AR:'Argentina',AM:'Armenia',
  AU:'Australia',AT:'Austria',AZ:'Azerbaijan',BH:'Bahrain',BD:'Bangladesh',
  BE:'Belgium',BO:'Bolivia',BA:'Bosnia',BR:'Brazil',BG:'Bulgaria',
  CA:'Canada',CL:'Chile',CN:'China',CO:'Colombia',HR:'Croatia',
  CZ:'Czech Republic',DK:'Denmark',EG:'Egypt',ET:'Ethiopia',FI:'Finland',
  FR:'France',GE:'Georgia',DE:'Germany',GH:'Ghana',GR:'Greece',
  HK:'Hong Kong',HU:'Hungary',IN:'India',ID:'Indonesia',IQ:'Iraq',
  IE:'Ireland',IL:'Israel',IT:'Italy',JP:'Japan',JO:'Jordan',
  KZ:'Kazakhstan',KE:'Kenya',KW:'Kuwait',LB:'Lebanon',LY:'Libya',
  LT:'Lithuania',MK:'Macedonia',MY:'Malaysia',MX:'Mexico',MA:'Morocco',
  NL:'Netherlands',NZ:'New Zealand',NG:'Nigeria',NO:'Norway',OM:'Oman',
  PK:'Pakistan',PS:'Palestine',PE:'Peru',PH:'Philippines',PL:'Poland',
  PT:'Portugal',QA:'Qatar',RO:'Romania',RU:'Russia',SA:'Saudi Arabia',
  RS:'Serbia',SG:'Singapore',ZA:'South Africa',KR:'South Korea',ES:'Spain',
  SE:'Sweden',CH:'Switzerland',SY:'Syria',TW:'Taiwan',TH:'Thailand',
  TN:'Tunisia',TR:'Turkey',UA:'Ukraine',AE:'UAE',GB:'United Kingdom',
  US:'United States',UY:'Uruguay',UZ:'Uzbekistan',VE:'Venezuela',VN:'Vietnam',
  YE:'Yemen',ZW:'Zimbabwe',XK:'Kosovo',EX:'International',UK:'United Kingdom',
  UG:'Uganda',SO:'Somalia',SN:'Senegal',CM:'Cameroon',LU:'Luxembourg',TJ:'Tajikistan',
  EE:'Estonia',MZ:'Mozambique',TG:'Togo',MN:'Mongolia',LK:'Sri Lanka',NI:'Nicaragua',
  RW:'Rwanda',ER:'Eritrea',GN:'Guinea',AO:'Angola',GM:'Gambia',BF:'Burkina Faso',
  TD:'Chad',KM:'Comoros',SL:'Sierra Leone',
};

// Country → IANA timezone (primary/capital timezone for each country)
const COUNTRY_TZ = {
  AF:'Asia/Kabul',AL:'Europe/Tirane',DZ:'Africa/Algiers',AR:'America/Argentina/Buenos_Aires',
  AM:'Asia/Yerevan',AU:'Australia/Sydney',AT:'Europe/Vienna',AZ:'Asia/Baku',
  BH:'Asia/Bahrain',BD:'Asia/Dhaka',BE:'Europe/Brussels',BO:'America/La_Paz',
  BA:'Europe/Sarajevo',BR:'America/Sao_Paulo',BG:'Europe/Sofia',CA:'America/Toronto',
  CL:'America/Santiago',CN:'Asia/Shanghai',CO:'America/Bogota',HR:'Europe/Zagreb',
  CZ:'Europe/Prague',DK:'Europe/Copenhagen',EG:'Africa/Cairo',ET:'Africa/Addis_Ababa',
  FI:'Europe/Helsinki',FR:'Europe/Paris',GE:'Asia/Tbilisi',DE:'Europe/Berlin',
  GH:'Africa/Accra',GR:'Europe/Athens',HK:'Asia/Hong_Kong',HU:'Europe/Budapest',
  IN:'Asia/Kolkata',ID:'Asia/Jakarta',IQ:'Asia/Baghdad',IE:'Europe/Dublin',
  IL:'Asia/Jerusalem',IT:'Europe/Rome',JP:'Asia/Tokyo',JO:'Asia/Amman',
  KZ:'Asia/Almaty',KE:'Africa/Nairobi',KW:'Asia/Kuwait',LB:'Asia/Beirut',
  LY:'Africa/Tripoli',LT:'Europe/Vilnius',MK:'Europe/Skopje',MY:'Asia/Kuala_Lumpur',
  MX:'America/Mexico_City',MA:'Africa/Casablanca',NL:'Europe/Amsterdam',
  NZ:'Pacific/Auckland',NG:'Africa/Lagos',NO:'Europe/Oslo',OM:'Asia/Muscat',
  PK:'Asia/Karachi',PS:'Asia/Gaza',PE:'America/Lima',PH:'Asia/Manila',
  PL:'Europe/Warsaw',PT:'Europe/Lisbon',QA:'Asia/Qatar',RO:'Europe/Bucharest',
  RU:'Europe/Moscow',SA:'Asia/Riyadh',RS:'Europe/Belgrade',SG:'Asia/Singapore',
  ZA:'Africa/Johannesburg',KR:'Asia/Seoul',ES:'Europe/Madrid',SE:'Europe/Stockholm',
  CH:'Europe/Zurich',SY:'Asia/Damascus',TW:'Asia/Taipei',TH:'Asia/Bangkok',
  TN:'Africa/Tunis',TR:'Europe/Istanbul',UA:'Europe/Kiev',AE:'Asia/Dubai',
  GB:'Europe/London',UK:'Europe/London',US:'America/New_York',UY:'America/Montevideo',
  UZ:'Asia/Tashkent',VE:'America/Caracas',VN:'Asia/Ho_Chi_Minh',YE:'Asia/Aden',
  ZW:'Africa/Harare',XK:'Europe/Belgrade',EX:'UTC',
  UG:'Africa/Kampala',SO:'Africa/Mogadishu',SN:'Africa/Dakar',CM:'Africa/Douala',
  LU:'Europe/Luxembourg',TJ:'Asia/Dushanbe',EE:'Europe/Tallinn',MZ:'Africa/Maputo',
  TG:'Africa/Lome',MN:'Asia/Ulaanbaatar',LK:'Asia/Colombo',NI:'America/Managua',
  RW:'Africa/Kigali',ER:'Africa/Asmara',GN:'Africa/Conakry',AO:'Africa/Luanda',
  GM:'Africa/Banjul',BF:'Africa/Ouagadougou',TD:'Africa/Ndjamena',KM:'Indian/Comoro',
  SL:'Africa/Freetown',
};

// ── Single virtualised channel row — must be outside component to avoid re-creating on every render
function ChannelRow({ index, style, data }) {
  const { channels, activeChannel, onPlay, bookmarkedIds, onBookmark, getEpg } = data;
  const ch = channels[index];
  const isActive = activeChannel?.id === ch.id;
  const isBookmarked = bookmarkedIds.has(ch.id);
  const epg = getEpg(ch.epg_id);
  const nowProg = epg?.now;
  const pct = nowProg ? Math.max(0, Math.min(100, ((Date.now() / 1000 - nowProg.start) / (nowProg.stop - nowProg.start)) * 100)) : 0;

  return (
    <div
      style={style}
      className={`w-full flex items-center transition-colors group border-l-2 ${
        isActive ? 'bg-vault-accent/10 border-vault-accent' : 'hover:bg-vault-card border-transparent'
      }`}
    >
      <button
        onClick={() => onPlay(ch)}
        className="flex-1 flex items-center gap-3 px-3 text-left min-w-0 h-full"
      >
        <div className="w-8 h-8 rounded bg-vault-card flex items-center justify-center shrink-0">
          {ch.logo ? (
            <img src={ch.logo} alt="" className="w-6 h-6 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
          ) : (
            <svg className="w-4 h-4 text-vault-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-vault-text truncate">{ch.name}</p>
          {nowProg ? (
            <div className="mt-0.5">
              <p className="text-[10px] text-vault-teal truncate leading-none">{nowProg.title}</p>
              <div className="mt-1 h-0.5 rounded-full bg-vault-border overflow-hidden">
                <div className="h-full bg-vault-teal/60 rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-vault-muted truncate">{ch.group}</p>
          )}
        </div>
        {isActive && (
          <div className="flex items-center gap-1 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
            <span className="text-[9px] text-red-400 font-bold uppercase">Live</span>
          </div>
        )}
      </button>
      <button
        onClick={() => onBookmark(ch)}
        className={`shrink-0 px-2 h-full flex items-center transition-all ${
          isBookmarked
            ? 'text-vault-gold opacity-100'
            : 'text-vault-muted opacity-0 group-hover:opacity-100 hover:text-vault-gold'
        }`}
        title={isBookmarked ? 'Remove bookmark' : 'Bookmark channel'}
      >
        <svg className="w-3.5 h-3.5" fill={isBookmarked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
        </svg>
      </button>
    </div>
  );
}

// Tab button
function Tab({ label, active, onClick, count }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 ${
        active
          ? 'border-vault-accent text-vault-accent'
          : 'border-transparent text-vault-muted hover:text-vault-text'
      }`}
    >
      {label}
      {count != null && (
        <span className={`ml-1.5 text-[10px] px-1 py-0.5 rounded ${active ? 'bg-vault-accent/20' : 'bg-vault-card'}`}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

function GenreSidebar({ genres, active, onSelect }) {
  return (
    <div className="w-52 shrink-0 border-r border-vault-border flex flex-col bg-vault-surface/50 overflow-y-auto py-1">
      {genres.map((g) => (
        <button
          key={g}
          onClick={() => onSelect(g)}
          className={`w-full text-left px-4 py-2 text-xs transition-colors border-l-2 ${
            active === g
              ? 'border-vault-accent bg-vault-accent/10 text-vault-accent font-medium'
              : 'border-transparent text-vault-muted hover:text-vault-text hover:bg-vault-card'
          }`}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

export default function LiveTVPage({ navPayload, onClearNavPayload }) {
  const { config, updateConfig } = useConfig();

  // ── Source / credentials ──────────────────────────────────────────────────
  // Initialize from pre-loaded cache (populated by SplashScreen) or DEMO_CHANNELS
  const [channels, setChannels] = useState(() => {
    const cached = getChannelCache();
    return cached.length > 0 ? cached : DEMO_CHANNELS;
  });
  const [xtreamCreds, setXtreamCreds] = useState({
    base: config.iptv.xtreamBase || '',
    user: config.iptv.xtreamUser || '',
    pass: config.iptv.xtreamPass || '',
  });
  const [m3uInput, setM3uInput] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('live'); // 'live' | 'vod' | 'series'

  // VOD — category-first: load category list fast, items on demand per category
  const [vodCategories, setVodCategories] = useState([]);
  const [activeVodCategory, setActiveVodCategory] = useState(null); // {id, name}
  const [vodItemsByCategory, setVodItemsByCategory] = useState({}); // {categoryId: items[]}
  const [loadingVodCats, setLoadingVodCats] = useState(false);
  const [loadingVodItems, setLoadingVodItems] = useState(false);
  const [vodSearchTerm, setVodSearchTerm] = useState('');
  const [vodSearchDebounced, setVodSearchDebounced] = useState('');
  const vodContainerRef = useRef(null);
  const [vodContainerWidth, setVodContainerWidth] = useState(800);

  // Series — same pattern
  const [seriesCategories, setSeriesCategories] = useState([]);
  const [activeSeriesCategory, setActiveSeriesCategory] = useState(null);
  const [seriesItemsByCategory, setSeriesItemsByCategory] = useState({});
  const [loadingSeriesCats, setLoadingSeriesCats] = useState(false);
  const [loadingSeriesItems, setLoadingSeriesItems] = useState(false);

  // VOD and Series country filters
  const [vodCountryFilter, setVodCountryFilter] = useState(null);
  const [seriesCountryFilter, setSeriesCountryFilter] = useState(null);

  // ── Live channel state ────────────────────────────────────────────────────
  const [activeChannel, setActiveChannel] = useState(null);
  const [activeCountry, setActiveCountry] = useState(() => localStorage.getItem('livetvCountry') ?? null);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [activeGroup, setActiveGroup] = useState(() => localStorage.getItem('livetvGroup') ?? 'All');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  // ── Player refs ───────────────────────────────────────────────────────────
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const listContainerRef = useRef(null);
  const [listHeight, setListHeight] = useState(500);

  // ── EPG ───────────────────────────────────────────────────────────────────
  const { status: epgStatus, checkStatus: checkEpgStatus, fetchNow: fetchEpgNow,
          refreshNow: refreshEpgNow, getEpg, triggerFetch: triggerEpgFetch, getSchedule } = useEpg();
  const [epgFetching, setEpgFetching] = useState(false);
  const [epgMatching, setEpgMatching] = useState(false);
  const [epgMatchResult, setEpgMatchResult] = useState(null); // number of matched channels
  const [showEpgPanel, setShowEpgPanel] = useState(false);
  const [showEpgGrid, setShowEpgGrid] = useState(false);
  const [epgSchedule, setEpgSchedule] = useState([]);
  const [epgScheduleLoading, setEpgScheduleLoading] = useState(false);

  // ── Persist country + group selection ────────────────────────────────────
  useEffect(() => {
    if (activeCountry) localStorage.setItem('livetvCountry', activeCountry);
    else localStorage.removeItem('livetvCountry');
  }, [activeCountry]);

  useEffect(() => {
    if (activeGroup && activeGroup !== 'All') localStorage.setItem('livetvGroup', activeGroup);
    else localStorage.removeItem('livetvGroup');
  }, [activeGroup]);

  // ── Debounce search 300ms ─────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    const t = setTimeout(() => setVodSearchDebounced(vodSearchTerm), 300);
    return () => clearTimeout(t);
  }, [vodSearchTerm]);

  // ── Measure VOD container width for virtual grid ──────────────────────────
  useEffect(() => {
    if (!vodContainerRef.current) return;
    const ro = new ResizeObserver(([entry]) => setVodContainerWidth(entry.contentRect.width));
    ro.observe(vodContainerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Measure list container height ─────────────────────────────────────────
  useEffect(() => {
    if (!listContainerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setListHeight(entry.contentRect.height);
    });
    ro.observe(listContainerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── HLS cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => () => hlsRef.current?.destroy(), []);

  // ── EPG: check status once on mount ──────────────────────────────────────
  useEffect(() => { checkEpgStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load channels on mount ────────────────────────────────────────────────
  // Priority: 1) cache (set by SplashScreen) → instant, no fetch needed
  //           2) DB preload (if no cache but xtream configured) → fast local read
  //           3) nothing (first-time user, show DEMO_CHANNELS)
  useEffect(() => {
    const cached = getChannelCache();
    if (cached.length > 0) {
      // Cache already populated by SplashScreen — extract allGroups and sync config
      const allGroups = [...new Set(cached.map((c) => c.group).filter(Boolean))];
      updateConfig('iptv', { allGroups });
      return;
    }
    // No cache — try loading from DB (fast local SQLite read)
    if (config.iptv.mode === 'xtream' && config.iptv.xtreamBase) {
      setXtreamCreds({ base: config.iptv.xtreamBase, user: config.iptv.xtreamUser, pass: config.iptv.xtreamPass });
      setLoading(true);
      fetch('/api/iptv/preload')
        .then((r) => r.json())
        .then((data) => {
          if (data.channels?.length > 0) {
            setChannels(data.channels);
            setChannelCache(data.channels);
            const allGroups = [...new Set(data.channels.map((c) => c.group).filter(Boolean))];
            updateConfig('iptv', { allGroups });
          }
        })
        .catch((err) => console.error('[LiveTV] preload failed:', err))
        .finally(() => setLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch category lists when tab first opens ─────────────────────────────
  useEffect(() => {
    if (activeTab === 'vod' && vodCategories.length === 0 && xtreamCreds.base) fetchVodCategories();
    if (activeTab === 'series' && seriesCategories.length === 0 && xtreamCreds.base) fetchSeriesCategories();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── Derived: groups visible in Live tab ──────────────────────────────────
  const hiddenGroups = config.iptv.hiddenGroups ?? [];

  // ── Country detection (runs once per channels load) ──────────────────────
  const detectedCountries = useMemo(() => {
    const counts = {};
    for (const ch of channels) {
      const code = detectCountryCode(ch);
      if (code && code.length === 2) counts[code] = (counts[code] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1]) // most channels first
      .map(([code, count]) => ({ code, count }));
  }, [channels]);

  const visibleGroups = useMemo(() => {
    const base = activeCountry
      ? channels.filter((c) => detectCountryCode(c) === activeCountry)
      : channels;
    const all = [...new Set(base.map((c) => c.group).filter(Boolean))];
    return all.filter((g) => !hiddenGroups.includes(g));
  }, [channels, hiddenGroups, activeCountry]);

  const { bookmarkedIds, toggle: toggleBookmark } = useBookmarks('channel');

  const groups = useMemo(() => {
    const extras = bookmarkedIds.size > 0 ? ['Favorites'] : [];
    return ['All', ...extras, ...visibleGroups];
  }, [visibleGroups, bookmarkedIds]);

  const visibleChannels = useMemo(() => {
    let base = activeCountry
      ? channels.filter((c) => detectCountryCode(c) === activeCountry && !hiddenGroups.includes(c.group))
      : channels.filter((c) => !hiddenGroups.includes(c.group));
    if (activeGroup === 'Favorites') return base.filter((c) => bookmarkedIds.has(c.id));
    if (activeGroup !== 'All') base = base.filter((c) => c.group === activeGroup);
    if (!searchDebounced) return base;
    const q = searchDebounced.toLowerCase();
    return base.filter((c) => c.name.toLowerCase().includes(q));
  }, [channels, hiddenGroups, activeCountry, activeGroup, searchDebounced, bookmarkedIds]);

  // ── EPG: fetch now/next for visible channels when group changes ───────────
  useEffect(() => {
    const ids = visibleChannels.map((c) => c.epg_id).filter(Boolean);
    if (ids.length) fetchEpgNow(ids);
  }, [visibleChannels]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── EPG: refresh now/next every 60 s to catch programme changes ──────────
  useEffect(() => {
    const t = setInterval(() => {
      const ids = visibleChannels.map((c) => c.epg_id).filter(Boolean);
      if (ids.length) refreshEpgNow(ids);
    }, 60_000);
    return () => clearInterval(t);
  }, [visibleChannels]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── VOD country detection and filtering ────────────────────────────────────
  const vodDetectedCountries = useMemo(() => {
    const map = {};
    vodCategories.forEach((cat) => {
      const code = detectCategoryCountry(cat.name);
      if (code) map[code] = (map[code] || 0) + 1;
    });
    return Object.entries(map)
      .map(([code, count]) => ({ code, name: COUNTRY_NAMES[code] ?? code, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [vodCategories]);

  const filteredVodCategories = useMemo(() => {
    if (!vodCountryFilter) return vodCategories;
    return vodCategories.filter((cat) => detectCategoryCountry(cat.name) === vodCountryFilter);
  }, [vodCategories, vodCountryFilter]);

  // ── Series country detection and filtering ───────────────────────────────────
  const seriesDetectedCountries = useMemo(() => {
    const map = {};
    seriesCategories.forEach((cat) => {
      const code = detectCategoryCountry(cat.name);
      if (code) map[code] = (map[code] || 0) + 1;
    });
    return Object.entries(map)
      .map(([code, count]) => ({ code, name: COUNTRY_NAMES[code] ?? code, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [seriesCategories]);

  const filteredSeriesCategories = useMemo(() => {
    if (!seriesCountryFilter) return seriesCategories;
    return seriesCategories.filter((cat) => detectCategoryCountry(cat.name) === seriesCountryFilter);
  }, [seriesCategories, seriesCountryFilter]);

  // ── VOD bookmarks ─────────────────────────────────────────────────────────
  const { bookmarkedIds: vodBookmarkedIds, toggle: toggleVodBookmark } = useBookmarks('vod');

  // ── Derived: current VOD items (from cache) ───────────────────────────────
  const currentVodItems = useMemo(() => {
    if (!activeVodCategory) return [];
    const items = vodItemsByCategory[activeVodCategory.id] ?? [];
    if (!vodSearchDebounced) return items;
    const q = vodSearchDebounced.toLowerCase();
    return items.filter((v) => v.title.toLowerCase().includes(q));
  }, [vodItemsByCategory, activeVodCategory, vodSearchDebounced]);

  const currentSeriesItems = useMemo(() => {
    if (!activeSeriesCategory) return [];
    return seriesItemsByCategory[activeSeriesCategory.id] ?? [];
  }, [seriesItemsByCategory, activeSeriesCategory]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const [playerStatus, setPlayerStatus] = useState('idle'); // 'idle' | 'loading' | 'playing' | 'error'

  const playChannel = useCallback((channel) => {
    // Always use the freshest channel data from the loaded list (has current epg_id)
    // If exact ID not found, fuzzy-match by name (handles provider channel renames/reIDs)
    let fresh = channels.find(c => c.id === channel.id);
    // Check if the provider recycled this ID for a completely different channel
    if (fresh && (channel.title || channel.name)) {
      const coreN = (s) => s.replace(/^[A-Z]{2,3}\|\s*/i, '').replace(/\s*\[.*?\]\s*/g, '').replace(/\s+/g, '').toLowerCase().trim();
      const bk = coreN(channel.title ?? channel.name);
      const mk = coreN(fresh.name);
      if (bk && mk && bk !== mk && !mk.includes(bk) && !bk.includes(mk)) fresh = null;
    }
    if (!fresh && channels.length > 0) {
      // Normalise: strip country prefix, collapse spaces, lower-case
      const norm = (s) => s.replace(/^[A-Z]{2,3}\|\s*/i, '').replace(/\s+/g, ' ').toLowerCase().trim();
      const needle = norm(channel.title ?? channel.name ?? '');
      // "core" strips quality tags [720p] etc. AND removes all spaces for fuzzy comparison
      // This handles renames like "TV2 NEWS" → "TV 2 NEWS"
      const core = (s) => norm(s).replace(/\s*\[.*?\]\s*/g, '').replace(/\s+/g, '').trim();
      const needleCore = core(channel.title ?? channel.name ?? '');
      if (needle) {
        // Try exact normalised name match
        fresh = channels.find(c => norm(c.name) === needle);
        // Try matching without quality tags (e.g. "tv2 news" ≈ "tv 2 news")
        if (!fresh && needleCore) {
          fresh = channels.find(c => core(c.name) === needleCore);
        }
        // Fallback: core name contains (pick best quality: prefer [720p])
        if (!fresh && needleCore) {
          const matches = channels.filter(c => {
            const h = core(c.name);
            return h.includes(needleCore) || needleCore.includes(h);
          });
          // Prefer 720p match, then first match
          fresh = matches.find(c => c.name.includes('[720p]')) || matches[0];
        }
      }
    }
    if (!fresh) fresh = channel;
    setActiveChannel(fresh);
    setPlayerStatus('loading');
    const video = videoRef.current;
    if (!video || !fresh.url) { setPlayerStatus('error'); return; }

    if (Hls.isSupported()) {
      hlsRef.current?.destroy();
      let recoverAttempts = 0;
      const hls = new Hls({
        enableWorker: true,
        startLevel: 0,
        testBandwidth: false,
        // WAN headroom: absorb round-trip jitter when streaming through the
        // remote proxy. Too small (e.g. 8s) starves the live buffer over the
        // internet and causes constant "Buffering…".
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        startFragPrefetch: true,
        lowLatencyMode: false,
        // Retry manifest/level loads on transient failures before giving up
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 1000,
      });
      hlsRef.current = hls;
      // Route through backend proxy to bypass CORS on the IPTV server
      // Append JWT token as query param so HLS.js requests pass the auth wall
      const authToken = localStorage.getItem('mediavault_token') || '';
      const src = fresh.url.startsWith('http')
        ? `/api/iptv/proxy?url=${encodeURIComponent(fresh.url)}&token=${encodeURIComponent(authToken)}`
        : fresh.url;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => setPlayerStatus('playing'));
      hls.on(Hls.Events.ERROR, (_, data) => {
        console.warn('[HLS]', data.type, data.details, data.fatal, data.response?.code);
        if (data.fatal) {
          // Try to recover from fatal errors before giving up
          if (recoverAttempts < 3 && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            recoverAttempts++;
            console.log(`[HLS] Media error recovery attempt ${recoverAttempts}/3...`);
            hls.recoverMediaError();
          } else if (recoverAttempts < 3 && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            recoverAttempts++;
            console.log(`[HLS] Network error recovery attempt ${recoverAttempts}/3...`);
            hls.startLoad();
          } else {
            setPlayerStatus('error');
            hls.destroy();
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = fresh.url;
      video.play().catch(() => {});
      video.oncanplay = () => setPlayerStatus('playing');
    }
  }, [channels]);

  // Active VOD playback — uses a separate overlay modal so it doesn't
  // hijack the Live TV layout and doesn't conflict with the HLS videoRef.
  const [playingVod, setPlayingVod] = useState(null);
  const playVod = useCallback((vod) => {
    if (!vod?.url) return;
    // Switch to VOD tab so when the user closes the movie they're back in
    // movie land, not on a random channel list.
    setActiveTab('vod');
    setPlayingVod(vod);
  }, []);

  // Must come after playChannel to avoid temporal dead zone
  const listItemData = useMemo(
    () => ({ channels: visibleChannels, activeChannel, onPlay: playChannel, bookmarkedIds, onBookmark: toggleBookmark, getEpg }),
    [visibleChannels, activeChannel, playChannel, bookmarkedIds, toggleBookmark, getEpg]
  );

  // Auto-play channel passed from another page (e.g. bookmarked channel on Home)
  // Wait until real channels are loaded (not DEMO_CHANNELS) so fuzzy matching works
  const channelsReady = channels.length > 0 && channels[0]?.id !== 'c1';
  useEffect(() => {
    if (!navPayload) return;

    // VOD bookmark navigation: payload.type === 'vod' (or _tab === 'vod') → play directly
    if (navPayload._tab === 'vod' || navPayload.type === 'vod') {
      playVod(navPayload);
      onClearNavPayload?.();
      return;
    }
    if (navPayload._tab === 'series' || navPayload.type === 'series') {
      setActiveTab('series');
      onClearNavPayload?.();
      return;
    }

    if (navPayload.url) {
      if (channelsReady) {
        setActiveTab('live');
        // Resolve the actual channel (fuzzy match) so we can switch country/group
        const resolveChannel = (ch) => {
          let fresh = channels.find(c => c.id === ch.id);
          // If the ID-matched channel name doesn't resemble the bookmark title,
          // the provider recycled the stream ID — reject and fall through to fuzzy match
          if (fresh && (ch.title || ch.name)) {
            const coreN = (s) => s.replace(/^[A-Z]{2,3}\|\s*/i, '').replace(/\s*\[.*?\]\s*/g, '').replace(/\s+/g, '').toLowerCase().trim();
            const bookmarkCore = coreN(ch.title ?? ch.name);
            const matchedCore = coreN(fresh.name);
            if (bookmarkCore && matchedCore && bookmarkCore !== matchedCore && !matchedCore.includes(bookmarkCore) && !bookmarkCore.includes(matchedCore)) {
              fresh = null;
            }
          }
          if (!fresh) {
            const norm = (s) => s.replace(/^[A-Z]{2,3}\|\s*/i, '').replace(/\s+/g, ' ').toLowerCase().trim();
            const core = (s) => norm(s).replace(/\s*\[.*?\]\s*/g, '').replace(/\s+/g, '').trim();
            const needleCore = core(ch.title ?? ch.name ?? '');
            if (needleCore) {
              fresh = channels.find(c => core(c.name) === needleCore);
              if (!fresh) {
                const matches = channels.filter(c => { const h = core(c.name); return h.includes(needleCore) || needleCore.includes(h); });
                fresh = matches.find(c => c.name.includes('[720p]')) || matches[0];
              }
            }
          }
          return fresh ?? ch;
        };
        const resolved = resolveChannel(navPayload);
        // Switch country picker to the channel's country
        const country = detectCountryCode(resolved);
        if (country && country !== activeCountry) {
          setActiveCountry(country);
        }
        // Switch group to the channel's group (or 'All' if not visible)
        if (resolved.group) {
          setActiveGroup(resolved.group);
        } else {
          setActiveGroup('All');
        }
        setSearchTerm('');
        playChannel(resolved);
        onClearNavPayload?.();
      }
      // else: wait — this effect re-runs when channelsReady flips to true
    } else if (navPayload.search) {
      setActiveTab('live');
      setSearchTerm(navPayload.search);
      onClearNavPayload?.();
    }
  }, [navPayload, channelsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFetchEpg = async () => {
    if (!xtreamCreds.base) return;
    setEpgFetching(true);
    await triggerEpgFetch(xtreamCreds);
    // Poll until the background job finishes
    const poll = setInterval(async () => {
      const s = await checkEpgStatus();
      if (s?.job?.status !== 'running') { clearInterval(poll); setEpgFetching(false); }
    }, 2500);
  };

  const handleEpgAutoMatch = async () => {
    setEpgMatching(true);
    try {
      const res = await fetch('/api/iptv/epg-match', { method: 'POST' });
      const data = await res.json();
      setEpgMatchResult(data.matched);
      // Reload channels from DB so the new epg_ids are reflected in state
      const preload = await fetch('/api/iptv/preload').then(r => r.json());
      if (preload.channels?.length > 0) {
        setChannels(preload.channels);
        setChannelCache(preload.channels);
        clearNowCache(); // force re-fetch EPG with new epg_ids
      }
    } catch (err) {
      console.error('EPG auto-match failed:', err);
    } finally {
      setEpgMatching(false);
    }
  };

  const openEpgPanel = async (channel) => {
    if (!channel?.epg_id) return;
    setShowEpgPanel(true);
    setEpgScheduleLoading(true);
    const progs = await getSchedule(channel.epg_id);
    setEpgSchedule(progs);
    setEpgScheduleLoading(false);
  };

  const handleM3UUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseM3U(ev.target.result);
      if (parsed.length > 0) {
        setChannels(parsed);
        updateConfig('iptv', {
          mode: 'm3u',
          allGroups: [...new Set(parsed.map((c) => c.group).filter(Boolean))],
        });
      }
    };
    reader.readAsText(file);
  };

  const handleM3UUrl = async () => {
    if (!m3uInput) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/iptv/m3u?url=${encodeURIComponent(m3uInput)}`);
      const data = await res.json();
      if (data.channels?.length > 0) {
        setChannels(data.channels);
        updateConfig('iptv', {
          mode: 'm3u',
          m3uUrl: m3uInput,
          allGroups: [...new Set(data.channels.map((c) => c.group).filter(Boolean))],
        });
      }
    } catch (err) {
      console.error('Failed to fetch M3U:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleXtreamConnect = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/iptv/xtream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(xtreamCreds),
      });
      const data = await res.json();
      if (data.channels?.length > 0) {
        setChannels(data.channels);
        setChannelCache(data.channels);
        const allGroups = [...new Set(data.channels.map((c) => c.group).filter(Boolean))];
        updateConfig('iptv', {
          mode: 'xtream',
          xtreamBase: xtreamCreds.base,
          xtreamUser: xtreamCreds.user,
          xtreamPass: xtreamCreds.pass,
          allGroups,
        });
        setShowSetup(false);
      }
    } catch (err) {
      console.error('Xtream connect failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchVodCategories = async () => {
    setLoadingVodCats(true);
    try {
      // Try DB cache first
      const cachedRes = await fetch('/api/iptv/xtream/vod/categories/cached');
      const cachedData = await cachedRes.json();
      if (cachedData.categories?.length > 0) {
        setVodCategories(cachedData.categories);
        setLoadingVodCats(false);
        // Background refresh from API
        fetch('/api/iptv/xtream/vod/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(xtreamCreds),
        }).then(r => r.json()).then(data => {
          if (data.categories?.length > 0) setVodCategories(data.categories);
        }).catch(() => {});
        return;
      }
      // No cache — fetch from API
      const res = await fetch('/api/iptv/xtream/vod/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(xtreamCreds),
      });
      const data = await res.json();
      if (data.categories?.length > 0) setVodCategories(data.categories);
    } catch (err) {
      console.error('VOD categories fetch failed:', err);
    } finally {
      setLoadingVodCats(false);
    }
  };

  const fetchVodCategory = async (cat) => {
    if (vodItemsByCategory[cat.id]) { setActiveVodCategory(cat); return; }
    setActiveVodCategory(cat);
    setLoadingVodItems(true);
    try {
      // Try DB cache first
      const cachedRes = await fetch(`/api/iptv/xtream/vod/cached?category_id=${encodeURIComponent(cat.id)}`);
      const cachedData = await cachedRes.json();
      if (cachedData.items?.length > 0) {
        setVodItemsByCategory((prev) => ({ ...prev, [cat.id]: cachedData.items }));
        setLoadingVodItems(false);
        // Background refresh from API
        fetch('/api/iptv/xtream/vod', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...xtreamCreds, category_id: cat.id }),
        }).then(r => r.json()).then(data => {
          if (data.items?.length > 0) setVodItemsByCategory((prev) => ({ ...prev, [cat.id]: data.items }));
        }).catch(() => {});
        return;
      }
      // No cache — fetch from API
      const res = await fetch('/api/iptv/xtream/vod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...xtreamCreds, category_id: cat.id }),
      });
      const data = await res.json();
      setVodItemsByCategory((prev) => ({ ...prev, [cat.id]: data.items ?? [] }));
    } catch (err) {
      console.error('VOD items fetch failed:', err);
      setVodItemsByCategory((prev) => ({ ...prev, [cat.id]: [] }));
    } finally {
      setLoadingVodItems(false);
    }
  };

  const fetchSeriesCategories = async () => {
    setLoadingSeriesCats(true);
    try {
      // Try DB cache first
      const cachedRes = await fetch('/api/iptv/xtream/series/categories/cached');
      const cachedData = await cachedRes.json();
      if (cachedData.categories?.length > 0) {
        setSeriesCategories(cachedData.categories);
        setLoadingSeriesCats(false);
        // Background refresh from API
        fetch('/api/iptv/xtream/series/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(xtreamCreds),
        }).then(r => r.json()).then(data => {
          if (data.categories?.length > 0) setSeriesCategories(data.categories);
        }).catch(() => {});
        return;
      }
      // No cache — fetch from API
      const res = await fetch('/api/iptv/xtream/series/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(xtreamCreds),
      });
      const data = await res.json();
      if (data.categories?.length > 0) setSeriesCategories(data.categories);
    } catch (err) {
      console.error('Series categories fetch failed:', err);
    } finally {
      setLoadingSeriesCats(false);
    }
  };

  const fetchSeriesCategory = async (cat) => {
    if (seriesItemsByCategory[cat.id]) { setActiveSeriesCategory(cat); return; }
    setActiveSeriesCategory(cat);
    setLoadingSeriesItems(true);
    try {
      // Try DB cache first
      const cachedRes = await fetch(`/api/iptv/xtream/series/cached?category_id=${encodeURIComponent(cat.id)}`);
      const cachedData = await cachedRes.json();
      if (cachedData.items?.length > 0) {
        setSeriesItemsByCategory((prev) => ({ ...prev, [cat.id]: cachedData.items }));
        setLoadingSeriesItems(false);
        // Background refresh from API
        fetch('/api/iptv/xtream/series', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...xtreamCreds, category_id: cat.id }),
        }).then(r => r.json()).then(data => {
          if (data.items?.length > 0) setSeriesItemsByCategory((prev) => ({ ...prev, [cat.id]: data.items }));
        }).catch(() => {});
        return;
      }
      // No cache — fetch from API
      const res = await fetch('/api/iptv/xtream/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...xtreamCreds, category_id: cat.id }),
      });
      const data = await res.json();
      setSeriesItemsByCategory((prev) => ({ ...prev, [cat.id]: data.items ?? [] }));
    } catch (err) {
      console.error('Series items fetch failed:', err);
      setSeriesItemsByCategory((prev) => ({ ...prev, [cat.id]: [] }));
    } finally {
      setLoadingSeriesItems(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full animate-fade-in">

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0 border-b border-vault-border bg-vault-surface/50 px-4 shrink-0">
        <Tab label="Live TV" active={activeTab === 'live'} onClick={() => setActiveTab('live')} count={channels.length} />
        <Tab label="VOD" active={activeTab === 'vod'} onClick={() => setActiveTab('vod')} count={vodCategories.length || null} />
        <Tab label="Series" active={activeTab === 'series'} onClick={() => setActiveTab('series')} count={seriesCategories.length || null} />
      </div>

      {/* ── Live TV ──────────────────────────────────────────────────────── */}
      {activeTab === 'live' && (
        <div className="flex flex-1 min-h-0">

          {/* Sidebar */}
          <div className="w-72 shrink-0 border-r border-vault-border flex flex-col bg-vault-surface/50">

            {/* Search + add source */}
            <div className="p-3 border-b border-vault-border space-y-2 shrink-0">
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-vault-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search channels..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-md bg-vault-card border border-vault-border text-xs text-vault-text placeholder:text-vault-muted/60 focus:outline-none focus:border-vault-accent/50"
                />
              </div>
              <button
                onClick={() => setShowSetup(!showSetup)}
                className="w-full text-xs text-vault-teal hover:text-vault-teal/80 flex items-center gap-1 justify-center py-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add IPTV Source
              </button>
            </div>

            {/* Setup panel */}
            {showSetup && (
              <div className="p-3 border-b border-vault-border space-y-3 bg-vault-card/50 shrink-0">
                <p className="text-[10px] uppercase tracking-widest text-vault-muted font-medium">M3U Playlist</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="M3U URL..."
                    value={m3uInput}
                    onChange={(e) => setM3uInput(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded-md bg-vault-bg border border-vault-border text-xs text-vault-text focus:outline-none focus:border-vault-accent/50"
                  />
                  <button onClick={handleM3UUrl} disabled={loading} className="px-2 py-1 rounded-md bg-vault-accent text-white text-xs hover:bg-vault-accentHover disabled:opacity-50">
                    {loading ? '…' : 'Load'}
                  </button>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-1.5 rounded-md border border-dashed border-vault-border text-xs text-vault-muted hover:text-vault-text hover:border-vault-muted transition-colors"
                >
                  Upload .m3u file
                </button>
                <input ref={fileInputRef} type="file" accept=".m3u,.m3u8" className="hidden" onChange={handleM3UUpload} />

                <div className="border-t border-vault-border pt-3">
                  <p className="text-[10px] uppercase tracking-widest text-vault-muted font-medium mb-2">Xtream Codes</p>
                  <div className="space-y-2">
                    <input type="text" placeholder="Server URL" value={xtreamCreds.base}
                      onChange={(e) => setXtreamCreds({ ...xtreamCreds, base: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-md bg-vault-bg border border-vault-border text-xs text-vault-text focus:outline-none focus:border-vault-accent/50" />
                    <input type="text" placeholder="Username" value={xtreamCreds.user}
                      onChange={(e) => setXtreamCreds({ ...xtreamCreds, user: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-md bg-vault-bg border border-vault-border text-xs text-vault-text focus:outline-none focus:border-vault-accent/50" />
                    <input type="password" placeholder="Password" value={xtreamCreds.pass}
                      onChange={(e) => setXtreamCreds({ ...xtreamCreds, pass: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-md bg-vault-bg border border-vault-border text-xs text-vault-text focus:outline-none focus:border-vault-accent/50" />
                    <button onClick={handleXtreamConnect} disabled={loading}
                      className="w-full py-1.5 rounded-md bg-vault-teal text-black text-xs font-medium hover:bg-vault-teal/80 disabled:opacity-50">
                      {loading ? 'Connecting…' : 'Connect'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Country picker button + active badge */}
            {detectedCountries.length > 0 && (
              <div className="border-b border-vault-border shrink-0">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    onClick={() => { setShowCountryPicker(!showCountryPicker); setCountrySearch(''); }}
                    className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                      showCountryPicker
                        ? 'border-vault-accent/50 bg-vault-accent/10 text-vault-accent'
                        : 'border-vault-border bg-vault-card text-vault-muted hover:text-vault-text'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253" />
                    </svg>
                    <span className="truncate">
                      {activeCountry
                        ? `${COUNTRY_NAMES[activeCountry] ?? activeCountry} (${detectedCountries.find(c => c.code === activeCountry)?.count.toLocaleString() ?? ''})`
                        : `Countries (${detectedCountries.length})`}
                    </span>
                    <svg className={`w-3 h-3 shrink-0 ml-auto transition-transform ${showCountryPicker ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {activeCountry && (
                    <button
                      onClick={() => { setActiveCountry(null); setActiveGroup('All'); }}
                      className="shrink-0 p-1.5 rounded-md text-vault-muted hover:text-vault-text hover:bg-vault-card transition-colors"
                      title="Clear country filter"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Country picker panel */}
                {showCountryPicker && (
                  <div className="border-t border-vault-border bg-vault-bg/50">
                    <div className="p-2">
                      <input
                        type="text"
                        placeholder="Search countries..."
                        value={countrySearch}
                        onChange={(e) => setCountrySearch(e.target.value)}
                        autoFocus
                        className="w-full px-2 py-1.5 rounded-md bg-vault-card border border-vault-border text-xs text-vault-text placeholder:text-vault-muted/60 focus:outline-none focus:border-vault-accent/50"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto px-2 pb-2 grid grid-cols-2 gap-1">
                      <button
                        onClick={() => { setActiveCountry(null); setActiveGroup('All'); setShowCountryPicker(false); }}
                        className={`col-span-2 flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${
                          !activeCountry ? 'bg-vault-accent/20 text-vault-accent' : 'text-vault-muted hover:text-vault-text hover:bg-vault-card'
                        }`}
                      >
                        <span className="font-medium">All Countries</span>
                        <span className="text-[10px] opacity-60">{channels.length.toLocaleString()} ch</span>
                      </button>
                      {detectedCountries
                        .filter(({ code }) => {
                          if (!countrySearch) return true;
                          const q = countrySearch.toLowerCase();
                          return code.toLowerCase().includes(q) || (COUNTRY_NAMES[code] ?? '').toLowerCase().includes(q);
                        })
                        .map(({ code, count }) => (
                          <button
                            key={code}
                            onClick={() => { setActiveCountry(code); setActiveGroup('All'); setShowCountryPicker(false); }}
                            className={`flex flex-col items-start px-2 py-1.5 rounded-md text-xs transition-colors ${
                              activeCountry === code
                                ? 'bg-vault-accent/20 text-vault-accent'
                                : 'text-vault-muted hover:text-vault-text hover:bg-vault-card'
                            }`}
                          >
                            <span className="font-medium truncate w-full">{COUNTRY_NAMES[code] ?? code}</span>
                            <span className="text-[10px] opacity-60">{code} · {count.toLocaleString()}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Groups + channels — share remaining sidebar height */}
            <div className="flex flex-col flex-1 min-h-0">

              {/* Group list — proportional height, scrollable */}
              <div className="border-b border-vault-border flex flex-col shrink-0" style={{ flex: '0 0 35%', minHeight: 0 }}>
                <div className="flex items-center justify-between px-3 pt-2 pb-1 shrink-0">
                  <p className="text-[9px] uppercase tracking-widest text-vault-muted font-medium">
                    Groups · {groups.length - 1}
                  </p>
                  {activeGroup !== 'All' && activeGroup !== 'Favorites' && (
                    <button
                      onClick={() => setShowEpgGrid(true)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider text-vault-teal border border-vault-teal/30 hover:bg-vault-teal/10 transition-colors"
                      title={`Programme guide for ${activeGroup}`}
                    >
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Guide
                    </button>
                  )}
                </div>
                <div className="overflow-y-auto flex-1 min-h-0">
                  {groups.map((g) => (
                    <button
                      key={g}
                      onClick={() => setActiveGroup(g)}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors border-l-2 truncate ${
                        activeGroup === g
                          ? 'border-vault-accent bg-vault-accent/10 text-vault-accent font-medium'
                          : 'border-transparent text-vault-muted hover:text-vault-text hover:bg-vault-card'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Virtualised channel list */}
              <div ref={listContainerRef} className="flex-1 min-h-0">
                {visibleChannels.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 px-4 py-6 text-center">
                    {channels.length > 0 && hiddenGroups.length > 0 ? (
                      <>
                        <p className="text-xs text-vault-muted">All groups are hidden.</p>
                        <button
                          onClick={() => updateConfig('iptv', { hiddenGroups: [] })}
                          className="px-3 py-1.5 rounded-md bg-vault-teal text-black text-xs font-medium hover:bg-vault-teal/80 transition-colors"
                        >
                          Unhide all groups
                        </button>
                      </>
                    ) : (
                      <p className="text-[10px] text-vault-muted">No channels match</p>
                    )}
                  </div>
                ) : (
                  <FixedSizeList
                    height={listHeight}
                    itemCount={visibleChannels.length}
                    itemSize={66}
                    width="100%"
                    itemData={listItemData}
                    overscanCount={5}
                  >
                    {ChannelRow}
                  </FixedSizeList>
                )}
              </div>

              <div className="px-3 py-2 border-t border-vault-border shrink-0 space-y-1.5">
                <p className="text-[10px] text-vault-muted text-center">
                  {visibleChannels.length.toLocaleString()} / {channels.length.toLocaleString()} channels
                </p>
                {/* EPG fetch + auto-match buttons */}
                {xtreamCreds.base && (
                  <div className="space-y-1">
                    <button
                      onClick={handleFetchEpg}
                      disabled={epgFetching}
                      className="w-full flex items-center justify-center gap-1.5 py-1 rounded-md text-[10px] font-medium transition-colors bg-vault-card hover:bg-vault-border text-vault-muted hover:text-vault-text disabled:opacity-50"
                    >
                      {epgFetching ? (
                        <><span className="w-3 h-3 rounded-full border border-vault-teal border-t-transparent animate-spin inline-block" /> Fetching EPG…</>
                      ) : epgStatus?.count > 0 ? (
                        <><span className="text-green-400">✓</span> EPG {(epgStatus.count / 1000).toFixed(0)}k entries · refresh</>
                      ) : (
                        <><span>📺</span> Fetch EPG guide</>
                      )}
                    </button>
                    {epgStatus?.count > 0 && (
                      <button
                        onClick={handleEpgAutoMatch}
                        disabled={epgMatching}
                        className="w-full flex items-center justify-center gap-1.5 py-1 rounded-md text-[10px] font-medium transition-colors bg-vault-card hover:bg-vault-border text-vault-muted hover:text-vault-text disabled:opacity-50"
                      >
                        {epgMatching ? (
                          <><span className="w-3 h-3 rounded-full border border-vault-gold border-t-transparent animate-spin inline-block" /> Matching…</>
                        ) : epgMatchResult ? (
                          <><span className="text-vault-gold">✓</span> Matched {epgMatchResult} channels</>
                        ) : (
                          <><span>🔗</span> Auto-match EPG by name</>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* Player + EPG panel */}
          <div className="flex-1 flex min-w-0">
            {/* Player column */}
            <div className="flex-1 flex flex-col items-center justify-center bg-black/30 relative min-w-0">
              {/* Video element always in DOM so videoRef is available before first click */}
              <div className={`w-full h-full flex flex-col ${activeChannel ? '' : 'hidden'}`}>
                <div className="flex-1 relative bg-black flex items-center justify-center min-h-0">
                  <video ref={videoRef} className="w-full h-full object-contain" controls />
                  {playerStatus === 'loading' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-3 pointer-events-none">
                      <div className="w-10 h-10 rounded-full border-2 border-vault-teal border-t-transparent animate-spin" />
                      <p className="text-xs text-white/70">Buffering…</p>
                    </div>
                  )}
                  {playerStatus === 'error' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-2 pointer-events-none">
                      <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                      <p className="text-xs text-red-400">Stream failed to load</p>
                    </div>
                  )}
                  {activeChannel && (
                    <div className="absolute top-4 left-4 glass px-3 py-2 rounded-lg flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${playerStatus === 'playing' ? 'bg-red-500 live-dot' : 'bg-vault-muted'}`} />
                      <span className="text-xs font-medium text-white">{activeChannel.name}</span>
                      {activeChannel.group && <span className="text-[10px] text-white/50 ml-1">{activeChannel.group}</span>}
                    </div>
                  )}
                </div>

                {/* Now / Next + EPG button bar — always visible below video */}
                {(() => {
                  const epg = getEpg(activeChannel?.epg_id);
                  const nowProg = epg?.now;
                  const pct = nowProg ? Math.max(0, Math.min(100, ((Date.now() / 1000 - nowProg.start) / (nowProg.stop - nowProg.start)) * 100)) : 0;
                  return (
                    <div className="shrink-0 bg-black/90 border-t border-vault-border px-4 py-2 flex items-center gap-4">
                      {/* Programme info */}
                      <div className="flex-1 min-w-0">
                        {nowProg ? (
                          <>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[9px] font-bold uppercase tracking-wider text-vault-accent shrink-0">Now</span>
                              <span className="text-xs text-white truncate">{nowProg.title}</span>
                              <span className="text-[10px] text-vault-muted shrink-0">{fmtTime(nowProg.start)}–{fmtTime(nowProg.stop)}</span>
                            </div>
                            <div className="h-1 rounded-full bg-vault-border overflow-hidden">
                              <div className="h-full bg-vault-accent rounded-full transition-all duration-1000" style={{ width: `${pct}%` }} />
                            </div>
                          </>
                        ) : (
                          <span className="text-[10px] text-vault-muted/50">
                            {activeChannel?.epg_id ? 'No programme data for this channel' : 'No EPG ID — programme guide unavailable'}
                          </span>
                        )}
                      </div>
                      {/* Next programme */}
                      {epg?.next && (
                        <div className="shrink-0 text-right hidden sm:block">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-vault-muted">Next</p>
                          <p className="text-[10px] text-vault-muted truncate max-w-[180px]">{epg.next.title}</p>
                          <p className="text-[9px] text-vault-muted/60">{fmtTime(epg.next.start)}</p>
                        </div>
                      )}
                      {/* EPG schedule button */}
                      <button
                        onClick={() => showEpgPanel ? setShowEpgPanel(false) : openEpgPanel(activeChannel)}
                        className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${
                          showEpgPanel
                            ? 'bg-vault-teal/20 text-vault-teal'
                            : 'bg-vault-card text-vault-muted hover:text-vault-teal hover:bg-vault-teal/10'
                        }`}
                      >
                        {showEpgPanel ? '✕ Close' : '📅 Guide'}
                      </button>
                    </div>
                  );
                })()}
              </div>

              {!activeChannel && (
                <div className="text-center">
                  <svg className="w-16 h-16 text-vault-muted/30 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <p className="text-vault-muted text-sm">Select a channel to start watching</p>
                  <p className="text-vault-muted/50 text-xs mt-1">or add an IPTV source from the sidebar</p>
                </div>
              )}
            </div>

            {/* EPG schedule panel */}
            {showEpgPanel && (
              <div className="w-72 shrink-0 border-l border-vault-border flex flex-col bg-vault-surface overflow-hidden">
                <div className="px-4 py-3 border-b border-vault-border flex items-center justify-between shrink-0">
                  <div>
                    <p className="text-xs font-semibold text-vault-text">Programme Guide</p>
                    <p className="text-[10px] text-vault-muted truncate">{activeChannel?.name}</p>
                  </div>
                  <button onClick={() => setShowEpgPanel(false)} className="text-vault-muted hover:text-vault-text transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto py-1">
                  {epgScheduleLoading ? (
                    <div className="flex items-center justify-center h-32">
                      <div className="w-6 h-6 rounded-full border-2 border-vault-teal border-t-transparent animate-spin" />
                    </div>
                  ) : epgSchedule.length === 0 ? (
                    <p className="text-center text-vault-muted text-xs py-8">No guide data available</p>
                  ) : (
                    epgSchedule.map((prog, i) => {
                      const isNow = Date.now() / 1000 >= prog.start && Date.now() / 1000 < prog.stop;
                      const pct = isNow ? Math.max(0, Math.min(100, ((Date.now() / 1000 - prog.start) / (prog.stop - prog.start)) * 100)) : 0;
                      return (
                        <div key={i} className={`px-4 py-2.5 border-b border-vault-border/50 ${isNow ? 'bg-vault-accent/10' : ''}`}>
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-xs font-medium leading-snug ${isNow ? 'text-white' : 'text-vault-text'}`}>{prog.title}</p>
                            {isNow && <span className="text-[9px] font-bold text-vault-accent uppercase shrink-0 mt-0.5">Now</span>}
                          </div>
                          <p className="text-[10px] text-vault-muted mt-0.5">{fmtTime(prog.start)} – {fmtTime(prog.stop)}</p>
                          {isNow && (
                            <div className="mt-1.5 h-0.5 rounded-full bg-vault-border overflow-hidden">
                              <div className="h-full bg-vault-accent rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          )}
                          {prog.description && (
                            <p className="text-[10px] text-vault-muted/70 mt-1 line-clamp-2">{prog.description}</p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── VOD ──────────────────────────────────────────────────────────── */}
      {activeTab === 'vod' && (
        <div className="flex flex-1 min-h-0">
          {/* Category sidebar */}
          <div className="w-52 shrink-0 border-r border-vault-border flex flex-col bg-vault-surface/50">
            {vodDetectedCountries.length > 1 && (
              <div className="p-2 border-b border-vault-border shrink-0">
                <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
                  <button
                    onClick={() => setVodCountryFilter(null)}
                    className={`shrink-0 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      !vodCountryFilter ? 'bg-vault-accent text-white' : 'bg-vault-card text-vault-muted hover:text-white'
                    }`}
                  >
                    All ({vodCategories.length})
                  </button>
                  {vodDetectedCountries.map(({ code, name, count }) => (
                    <button
                      key={code}
                      onClick={() => setVodCountryFilter(code)}
                      className={`shrink-0 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                        vodCountryFilter === code ? 'bg-vault-accent text-white' : 'bg-vault-card text-vault-muted hover:text-white'
                      }`}
                      title={name}
                    >
                      {code} ({count})
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="p-2 border-b border-vault-border shrink-0">
              <input
                type="text"
                placeholder="Search titles…"
                value={vodSearchTerm}
                onChange={(e) => setVodSearchTerm(e.target.value)}
                className="w-full px-2 py-1.5 rounded-md bg-vault-card border border-vault-border text-xs text-vault-text placeholder:text-vault-muted/60 focus:outline-none focus:border-vault-accent/50"
              />
            </div>
            {loadingVodCats ? (
              <div className="flex items-center justify-center flex-1">
                <p className="text-xs text-vault-muted animate-pulse">Loading…</p>
              </div>
            ) : filteredVodCategories.length === 0 ? (
              <div className="flex items-center justify-center flex-1 px-4 text-center">
                <p className="text-xs text-vault-muted">{xtreamCreds.base ? 'No categories found' : 'Connect an Xtream source on Live TV'}</p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 py-1">
                {filteredVodCategories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => fetchVodCategory(cat)}
                    className={`w-full text-left px-4 py-2 text-xs transition-colors border-l-2 truncate ${
                      activeVodCategory?.id === cat.id
                        ? 'border-vault-accent bg-vault-accent/10 text-vault-accent font-medium'
                        : 'border-transparent text-vault-muted hover:text-vault-text hover:bg-vault-card'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Content area */}
          <div ref={vodContainerRef} className="flex-1 overflow-y-auto p-4">
            {!activeVodCategory ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                <svg className="w-12 h-12 text-vault-muted/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                </svg>
                <p className="text-vault-muted text-sm">Select a category to browse</p>
                <p className="text-vault-muted/50 text-xs">{vodCategories.length > 0 ? `${vodCategories.length} categories available` : ''}</p>
              </div>
            ) : loadingVodItems ? (
              <div className="flex items-center justify-center h-48">
                <div className="w-6 h-6 rounded-full border-2 border-vault-teal border-t-transparent animate-spin" />
              </div>
            ) : (
              <>
                <p className="text-[10px] text-vault-muted mb-4">
                  {activeVodCategory.name} · {currentVodItems.length.toLocaleString()} title{currentVodItems.length !== 1 ? 's' : ''}
                  {vodSearchDebounced && ` matching "${vodSearchDebounced}"`}
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
                  {currentVodItems.map((item) => (
                    <MediaCard
                      key={item.id}
                      item={item}
                      size="sm"
                      onPlay={playVod}
                      isBookmarked={vodBookmarkedIds.has(item.id)}
                      onBookmark={toggleVodBookmark}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Series ───────────────────────────────────────────────────────── */}
      {activeTab === 'series' && (
        <div className="flex flex-1 min-h-0">
          {/* Category sidebar */}
          <div className="w-52 shrink-0 border-r border-vault-border flex flex-col bg-vault-surface/50">
            {seriesDetectedCountries.length > 1 && (
              <div className="p-2 border-b border-vault-border shrink-0">
                <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
                  <button
                    onClick={() => setSeriesCountryFilter(null)}
                    className={`shrink-0 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      !seriesCountryFilter ? 'bg-vault-accent text-white' : 'bg-vault-card text-vault-muted hover:text-white'
                    }`}
                  >
                    All ({seriesCategories.length})
                  </button>
                  {seriesDetectedCountries.map(({ code, name, count }) => (
                    <button
                      key={code}
                      onClick={() => setSeriesCountryFilter(code)}
                      className={`shrink-0 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                        seriesCountryFilter === code ? 'bg-vault-accent text-white' : 'bg-vault-card text-vault-muted hover:text-white'
                      }`}
                      title={name}
                    >
                      {code} ({count})
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="p-2 border-b border-vault-border shrink-0">
              <input
                type="text"
                placeholder="Search titles…"
                value={vodSearchTerm}
                onChange={(e) => setVodSearchTerm(e.target.value)}
                className="w-full px-2 py-1.5 rounded-md bg-vault-card border border-vault-border text-xs text-vault-text placeholder:text-vault-muted/60 focus:outline-none focus:border-vault-accent/50"
              />
            </div>
            {loadingSeriesCats ? (
              <div className="flex items-center justify-center flex-1">
                <p className="text-xs text-vault-muted animate-pulse">Loading…</p>
              </div>
            ) : filteredSeriesCategories.length === 0 ? (
              <div className="flex items-center justify-center flex-1 px-4 text-center">
                <p className="text-xs text-vault-muted">{xtreamCreds.base ? 'No categories found' : 'Connect an Xtream source on Live TV'}</p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 py-1">
                {filteredSeriesCategories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => fetchSeriesCategory(cat)}
                    className={`w-full text-left px-4 py-2 text-xs transition-colors border-l-2 truncate ${
                      activeSeriesCategory?.id === cat.id
                        ? 'border-vault-accent bg-vault-accent/10 text-vault-accent font-medium'
                        : 'border-transparent text-vault-muted hover:text-vault-text hover:bg-vault-card'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto p-4">
            {!activeSeriesCategory ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                <p className="text-vault-muted text-sm">Select a category to browse</p>
                <p className="text-vault-muted/50 text-xs">{seriesCategories.length > 0 ? `${seriesCategories.length} categories available` : ''}</p>
              </div>
            ) : loadingSeriesItems ? (
              <div className="flex items-center justify-center h-48">
                <div className="w-6 h-6 rounded-full border-2 border-vault-teal border-t-transparent animate-spin" />
              </div>
            ) : (
              <>
                <p className="text-[10px] text-vault-muted mb-4">
                  {activeSeriesCategory.name} · {currentSeriesItems.length.toLocaleString()} series
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
                  {currentSeriesItems.map((item) => (
                    <MediaCard
                      key={item.id}
                      item={item}
                      size="sm"
                      onPlay={playVod}
                      isBookmarked={vodBookmarkedIds.has(item.id)}
                      onBookmark={toggleVodBookmark}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── EPG Grid overlay ─────────────────────────────────────────────── */}
      {showEpgGrid && (
        <EpgGrid
          channels={visibleChannels}
          timezone={activeCountry ? (COUNTRY_TZ[activeCountry] ?? 'UTC') : 'UTC'}
          onClose={() => setShowEpgGrid(false)}
        />
      )}

      {/* ── VOD playback overlay ────────────────────────────────────────── */}
      {playingVod && <VodOverlay vod={playingVod} onClose={() => setPlayingVod(null)} />}
    </div>
  );
}

// Fullscreen-ish modal that plays an Xtream VOD via the ffmpeg remux endpoint.
// Separate from LiveTV's videoRef so the HLS player isn't disturbed.
function VodOverlay({ vod, onClose }) {
  const videoRef = useRef(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const token = localStorage.getItem('mediavault_token') || '';
    v.src = `/api/iptv/vod-remux?url=${encodeURIComponent(vod.url)}&token=${encodeURIComponent(token)}`;
    v.play().catch(() => {});
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [vod.url, onClose]);

  return (
    <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 bg-black/40">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white truncate">{vod.title || vod.name}</h2>
          {vod.year && <p className="text-[11px] text-vault-muted mt-0.5">{vod.year}{vod.rating ? ` • ★ ${vod.rating}` : ''}</p>}
        </div>
        <button onClick={onClose} className="p-2 rounded-lg text-vault-muted hover:text-white hover:bg-white/10">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center bg-black">
        <video ref={videoRef} className="max-w-full max-h-full" controls autoPlay />
      </div>
    </div>
  );
}
