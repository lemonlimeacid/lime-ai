/* Lime AI — theme presets, light/dark tone and optional 3D depth. */

export const THEME_PRESETS = [
  {
    id: 'lime-dark',
    label: 'Lime dark',
    palette: 'lime',
    tone: 'dark',
    pair: 'lime-light',
    default: true,
    description: 'Electric lime on deep green-black.',
    preview: {
      gradient: 'linear-gradient(135deg, #263a18 0%, #0a0f08 58%, #111c0c 100%)',
      panel: 'rgba(19, 28, 15, 0.94)',
      line: 'rgba(183, 245, 58, 0.24)',
      ink: '#e9f8dc',
      dot: '#b7f53a',
    },
  },
  {
    id: 'lime-light',
    label: 'Lime light',
    palette: 'lime',
    tone: 'light',
    pair: 'lime-dark',
    description: 'Bright lime gradients on warm paper.',
    preview: {
      gradient: 'linear-gradient(135deg, #efffd0 0%, #ddf7b8 52%, #f6f1df 100%)',
      panel: 'rgba(252, 255, 245, 0.94)',
      line: 'rgba(91, 156, 24, 0.28)',
      ink: '#2a4215',
      dot: '#6db916',
    },
  },
  {
    id: 'peach',
    label: 'Peach',
    palette: 'peach',
    tone: 'light',
    pair: 'dusk',
    description: 'A soft peach sunrise with coral light.',
    preview: {
      gradient: 'linear-gradient(135deg, #fff0e4 0%, #ffd4c3 38%, #ffc3b5 68%, #ffadaa 100%)',
      panel: 'rgba(255, 249, 242, 0.94)',
      line: 'rgba(126, 73, 51, 0.26)',
      ink: '#543020',
      dot: '#e46a42',
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    palette: 'midnight',
    tone: 'dark',
    pair: 'lilac',
    description: 'Deep indigo with periwinkle starlight.',
    preview: {
      gradient: 'linear-gradient(135deg, #1c2b57 0%, #3b2a6b 52%, #172647 100%)',
      panel: 'rgba(20, 29, 57, 0.94)',
      line: 'rgba(165, 169, 255, 0.28)',
      ink: '#edeeff',
      dot: '#a5a6ff',
    },
  },
  {
    id: 'lilac',
    label: 'Lilac',
    palette: 'lilac',
    tone: 'light',
    pair: 'midnight',
    description: 'Pale lilac with a violet bloom.',
    preview: {
      gradient: 'linear-gradient(135deg, #f7f4ff 0%, #e7e0ff 46%, #ffd9ed 100%)',
      panel: 'rgba(253, 250, 255, 0.94)',
      line: 'rgba(101, 76, 160, 0.26)',
      ink: '#3b2b55',
      dot: '#6c4de0',
    },
  },
  {
    id: 'dusk',
    label: 'Dusk',
    palette: 'dusk',
    tone: 'dark',
    pair: 'peach',
    description: 'Plum dusk with a warm ember.',
    preview: {
      gradient: 'linear-gradient(135deg, #6f203d 0%, #57244f 46%, #3b1e40 74%, #251d3f 100%)',
      panel: 'rgba(48, 21, 43, 0.94)',
      line: 'rgba(255, 158, 122, 0.28)',
      ink: '#ffe7ee',
      dot: '#ff9e7a',
    },
  },
  {
    id: 'seafoam',
    label: 'Seafoam',
    palette: 'seafoam',
    tone: 'light',
    pair: 'graphite',
    description: 'Sea-glass mint and soft cream.',
    preview: {
      gradient: 'linear-gradient(135deg, #e9fff9 0%, #d5f7ed 44%, #faf4d9 100%)',
      panel: 'rgba(249, 255, 252, 0.94)',
      line: 'rgba(24, 112, 87, 0.24)',
      ink: '#18483a',
      dot: '#1f8a70',
    },
  },
  {
    id: 'graphite',
    label: 'Graphite',
    palette: 'graphite',
    tone: 'dark',
    pair: 'seafoam',
    description: 'Matte graphite with cool silver.',
    preview: {
      gradient: 'linear-gradient(135deg, #30353d 0%, #1b1f24 54%, #101215 100%)',
      panel: 'rgba(25, 29, 33, 0.94)',
      line: 'rgba(199, 208, 217, 0.24)',
      ink: '#eef1f4',
      dot: '#cfd6de',
    },
  },
  {
    id: 'daybreak',
    label: 'Daybreak',
    palette: 'daybreak',
    tone: 'light',
    pair: 'sherbet',
    description: 'Pale blue morning with a golden edge.',
    preview: {
      gradient: 'linear-gradient(135deg, #fff1d8 0%, #e4ecff 45%, #c7dcff 100%)',
      panel: 'rgba(249, 252, 255, 0.94)',
      line: 'rgba(47, 102, 200, 0.24)',
      ink: '#1e3760',
      dot: '#2f66c8',
    },
  },
  {
    id: 'sherbet',
    label: 'Sherbet',
    palette: 'sherbet',
    tone: 'light',
    pair: 'daybreak',
    description: 'Pink sherbet with a citrus blush.',
    preview: {
      gradient: 'linear-gradient(135deg, #ffe0c7 0%, #ffd2dd 44%, #ffa4b9 76%, #ffc8a8 100%)',
      panel: 'rgba(255, 248, 250, 0.94)',
      line: 'rgba(166, 73, 99, 0.25)',
      ink: '#4a2430',
      dot: '#d94f7a',
      dotted: true,
    },
  },
  {
    id: 'base-light',
    label: 'Light',
    palette: 'base',
    tone: 'light',
    pair: 'base-dark',
    description: 'Neutral warm paper with a terracotta accent.',
    preview: {
      gradient: 'linear-gradient(135deg, #f8e9d9 0%, #efe3d1 52%, #e6d7c3 100%)',
      panel: 'rgba(255, 250, 244, 0.94)',
      line: 'rgba(112, 82, 54, 0.24)',
      ink: '#3a2a1d',
      dot: '#c25e37',
    },
  },
  {
    id: 'base-dark',
    label: 'Dark',
    palette: 'base',
    tone: 'dark',
    pair: 'base-light',
    description: 'The original graphite interface.',
    preview: {
      gradient: 'linear-gradient(135deg, #292826 0%, #111110 62%, #1b1917 100%)',
      panel: 'rgba(24, 23, 22, 0.94)',
      line: 'rgba(225, 218, 205, 0.2)',
      ink: '#ece8df',
      dot: '#e07a52',
    },
  },
  {
    id: 'nova-light',
    label: 'Nova light',
    palette: 'nova',
    tone: 'light',
    pair: 'nova-dark',
    description: 'Soft lavender paper with a violet-to-cyan glow.',
    preview: {
      gradient: 'linear-gradient(135deg, #f4f0ff 0%, #e9e0ff 44%, #d9f4ff 100%)',
      panel: 'rgba(252, 250, 255, 0.94)',
      line: 'rgba(103, 87, 217, 0.25)',
      ink: '#30264e',
      dot: '#6757d9',
    },
  },
  {
    id: 'nova-dark',
    label: 'Nova dark',
    palette: 'nova',
    tone: 'dark',
    pair: 'nova-light',
    description: 'Deep space navy with violet and cyan light.',
    preview: {
      gradient: 'linear-gradient(135deg, #0b1024 0%, #1b1740 48%, #0a1a2c 100%)',
      panel: 'rgba(16, 21, 40, 0.94)',
      line: 'rgba(155, 140, 255, 0.28)',
      ink: '#e9e8ff',
      dot: '#9b8cff',
    },
  },
];

export const THEME_BY_ID = Object.fromEntries(THEME_PRESETS.map((theme) => [theme.id, theme]));

const THEME_ALIASES = {
  light: 'lime-light',
  dark: 'lime-dark',
  default: 'lime-dark',
  glass: 'lime-dark',
  minimal: 'lime-dark',
  lime: 'lime-dark',
  base: 'base-dark',
  nova: 'nova-dark',
};

export function normalizeTheme(value) {
  const id = String(value || '').trim().toLowerCase();
  return THEME_BY_ID[id] || THEME_BY_ID[THEME_ALIASES[id]] || THEME_BY_ID['lime-dark'];
}

export function oppositeTheme(value) {
  const current = normalizeTheme(value);
  return THEME_BY_ID[current.pair] || THEME_BY_ID['lime-dark'];
}

export function applyTheme(value, { persist = true } = {}) {
  const theme = normalizeTheme(value);
  const root = document.documentElement;
  root.dataset.theme = theme.tone;
  root.dataset.palette = theme.palette;
  if (persist) {
    try {
      localStorage.setItem('lime.theme', theme.id);
    } catch {
      /* Local storage can be unavailable; the in-memory setting still applies. */
    }
  }
  return theme;
}

export function applyDepth(enabled, { persist = true } = {}) {
  const on = enabled !== false;
  document.documentElement.setAttribute('data-3d', on ? 'on' : 'off');
  if (persist) {
    try {
      localStorage.setItem('lime.threeD', on ? 'on' : 'off');
    } catch {
      /* Local storage can be unavailable; the in-memory setting still applies. */
    }
  }
  return on;
}
