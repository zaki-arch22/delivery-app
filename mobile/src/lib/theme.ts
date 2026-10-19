// Brand direction A (CLAUDE.md section 7). Amber is ONLY for warnings and key alerts. Never rely on colour alone.
export const color = {
  primary: '#1E40AF',
  navy: '#0B2A6B',
  soft: '#E8EEFB',
  amber: '#F59E0B',
  page: '#F6F8FC',
  text: '#0B1530',
  muted: '#4A5578',     // secondary text (contrast checked on page and white)
  white: '#FFFFFF',
  border: '#C9D3EA',
  danger: '#B42318',    // error text (contrast checked on page and white)
};
export const font = { regular: 'Cairo_400Regular', semibold: 'Cairo_600SemiBold', bold: 'Cairo_700Bold' };
export const space = (n: number) => n * 4;
export const radius = 14;
export const minTouch = 56;   // large buttons (easy to hit on a moving motorbike or with one hand)
