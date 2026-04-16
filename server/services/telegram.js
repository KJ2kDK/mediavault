import { Bot } from 'grammy';
import { processMessage } from './chat-engine.js';
import { sendAction, getConnectedCount } from './ws-hub.js';

const MAX_MSG_LENGTH = 4000;

function toTelegramMarkdown(answer) {
  if (!answer) return '';
  let text = answer;
  // Escape characters that break Telegram Markdown parsing
  // but preserve **bold** and `code` formatting
  text = text.replace(/([_\[\]()~>#+\-=|{}.!\\])/g, '\\$1');
  // Restore **bold** (un-escape the asterisks used for bold)
  text = text.replace(/\\\*\\\*(.+?)\\\*\\\*/g, '*$1*');
  // Restore `code` backticks
  text = text.replace(/\\`(.+?)\\`/g, '`$1`');
  if (text.length > MAX_MSG_LENGTH) {
    text = text.slice(0, MAX_MSG_LENGTH - 3) + '...';
  }
  return text;
}

function formatItems(items) {
  if (!items?.length) return '';
  return '\n' + items.map((item, i) => `${i + 1}\\. ${toTelegramMarkdown(item.text)}`).join('\n');
}

export async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN not set — bot disabled');
    return;
  }

  const adminId = Number(process.env.TELEGRAM_ADMIN_ID);
  const bot = new Bot(token);

  function isAdmin(ctx) {
    return ctx.from?.id === adminId;
  }

  bot.on('message:text', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
      const result = await processMessage(ctx.message.text);
      let text = toTelegramMarkdown(result.answer);

      if (result.items?.length) {
        text += formatItems(result.items);
      }

      if (result.action && (result.action.type === 'play' || result.action.type === 'play-channel')) {
        const status = await sendAction(result.action);
        if (status.confirmed) {
          text += '\n\n_Playing on your browser_';
        } else {
          const url = result.action.streamUrl || result.action.url || '';
          if (url) {
            text += `\n\n[Open stream](${url})`;
          }
        }
      }

      await ctx.reply(text, { parse_mode: 'MarkdownV2' });
    } catch (err) {
      console.error('[telegram] text handler error:', err);
      await ctx.reply(`Error: ${err.message}`);
    }
  });

  bot.on('message:voice', async (ctx) => {
    if (!isAdmin(ctx)) return;

    const sttKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!sttKey) {
      await ctx.reply('Voice messages require OPENAI_API_KEY or OPENROUTER_API_KEY in .env');
      return;
    }

    const useOpenRouter = !process.env.OPENAI_API_KEY && !!process.env.OPENROUTER_API_KEY;
    const sttUrl = useOpenRouter
      ? 'https://openrouter.ai/api/v1/audio/transcriptions'
      : 'https://api.openai.com/v1/audio/transcriptions';

    try {
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
      const formData = new FormData();
      formData.append('file', blob, 'voice.ogg');
      formData.append('model', 'whisper-1');

      const r = await fetch(sttUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sttKey}` },
        body: formData,
      });

      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(`Whisper API ${r.status}: ${errBody.slice(0, 200)}`);
      }

      const { text: transcription } = await r.json();
      await ctx.reply(`Heard: "${transcription}"`);

      const result = await processMessage(transcription);
      let text = toTelegramMarkdown(result.answer);

      if (result.items?.length) {
        text += formatItems(result.items);
      }

      if (result.action && (result.action.type === 'play' || result.action.type === 'play-channel')) {
        const status = await sendAction(result.action);
        if (status.confirmed) {
          text += '\n\n_Playing on your browser_';
        } else {
          const url = result.action.streamUrl || result.action.url || '';
          if (url) {
            text += `\n\n[Open stream](${url})`;
          }
        }
      }

      await ctx.reply(text, { parse_mode: 'MarkdownV2' });
    } catch (err) {
      console.error('[telegram] voice handler error:', err);
      await ctx.reply(`Error: ${err.message}`);
    }
  });

  bot.start();
  const me = await bot.api.getMe();
  console.log(`[telegram] Bot started as @${me.username}`);
}
