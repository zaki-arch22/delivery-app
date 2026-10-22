// Look (owner's wishes, Oct 2026): dark, map-first, like the inDrive screenshots he chose as reference, with OUR blue for the
// ONE main action on each screen (the owner replaced inDrive's green by a blue). Our own icons, name and logo. Amber is ONLY
// for money to collect and warnings. Never rely on colour alone: every state also has a word or an icon.
// Contrast (checked): white text on brand 4.55:1, brand on the panel 3.6:1, accent text on the page 8.4:1.
const brand = '#2F6FED';
export const color = {
  page: '#121316',      // screen background
  card: '#1E1F24',      // sheets and cards
  card2: '#2A2C33',     // fields and secondary buttons on a card
  line: '#34363E',      // thin separators
  text: '#FFFFFF',
  muted: '#A6ABB8',     // secondary text (contrast checked on page and card)
  brand,                // main action (filled buttons, selected items, route, the online pill)
  onBrand: '#FFFFFF',   // text and icons on brand
  accent: '#7AB0FF',    // blue text and icons on the dark page and panels (brand itself is too dark for small text there)
  black: '#0E0F12',     // the near-black of the drop-off pin
  amber: '#F59E0B',
  danger: '#F04438',
  overlay: 'rgba(0,0,0,0.55)',
  pureWhite: '#FFFFFF',
  statusBar: '#26282E',
  search: '#3B82F6',    // the faint blue search circle on the map (owner's wish) // our grey band behind the phone's status bar (between panel and field grey)
  // Older names, kept so every screen follows the new look: they point at the new palette.
  primary: brand, navy: '#FFFFFF', soft: '#2A2C33', white: '#1E1F24', border: '#34363E',
};
export const font = { regular: 'Cairo_400Regular', semibold: 'Cairo_600SemiBold', bold: 'Cairo_700Bold' };
export const space = (n: number) => n * 4;
export const radius = 16;
export const bigRadius = 24;   // bottom sheets and large cards
export const minTouch = 56;    // large buttons (easy to hit on a moving motorbike or with one hand)
