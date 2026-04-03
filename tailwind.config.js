/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        vault: {
          bg: '#0a0a0f',
          surface: '#12121a',
          card: '#1a1a28',
          border: '#2a2a3a',
          accent: '#e50914',
          accentHover: '#ff1a25',
          gold: '#d4a843',
          teal: '#2dd4bf',
          text: '#e8e8f0',
          muted: '#8888a0',
        },
      },
      fontFamily: {
        display: ['"Bebas Neue"', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.6s ease-out forwards',
        'slide-up': 'slideUp 0.5s ease-out forwards',
        'slide-right': 'slideRight 0.4s ease-out forwards',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'logo-reveal': 'logoReveal 1.8s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideRight: {
          '0%': { opacity: '0', transform: 'translateX(-24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(229, 9, 20, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(229, 9, 20, 0.6)' },
        },
        logoReveal: {
          '0%': { opacity: '0', transform: 'scale(0.8)', filter: 'blur(10px)' },
          '60%': { opacity: '1', transform: 'scale(1.05)', filter: 'blur(0)' },
          '100%': { opacity: '1', transform: 'scale(1)', filter: 'blur(0)' },
        },
      },
    },
  },
  plugins: [],
};
