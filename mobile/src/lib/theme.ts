// Look (owner's wish, Oct 2026): dark, map-first, a lime colour for the ONE main action on each screen, like the inDrive
// screenshots he chose as reference; our own shade, icons, name and logo. Amber is ONLY for money to collect and warnings.
// Never rely on colour alone: every state also has a word or an icon.
const lime = '#B4EF2A';
export const color = {
  page: '#121316',      // screen background
  card: '#1E1F24',      // sheets and cards
  card2: '#2A2C33',     // fields and secondary buttons on a card
  line: '#34363E',      // thin separators
  text: '#FFFFFF',
  muted: '#A6ABB8',     // secondary text (contrast checked on page and card)
  lime,                 // main action
  ink: '#0E0F12',       // text on lime
  amber: '#F59E0B',
  danger: '#F04438',
  overlay: 'rgba(0,0,0,0.55)',
  pureWhite: '#FFFFFF',
  statusBar: '#26282E', // our grey band behind the phone's status bar (between panel and field grey)
  // Older names, kept so every screen follows the new look: they point at the new palette.
  primary: lime, navy: '#FFFFFF', soft: '#2A2C33', white: '#1E1F24', border: '#34363E',
};
export const font = { regular: 'Cairo_400Regular', semibold: 'Cairo_600SemiBold', bold: 'Cairo_700Bold' };
export const space = (n: number) => n * 4;
export const radius = 16;
export const bigRadius = 24;   // bottom sheets and large cards
export const minTouch = 56;    // large buttons (easy to hit on a moving motorbike or with one hand)
