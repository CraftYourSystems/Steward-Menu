export const customerKeys = {
  all: ['customer'] as const,
  session: (qrCode: string) => [...customerKeys.all, 'session', qrCode] as const,
  menu: (qrCode: string) => [...customerKeys.all, 'menu', qrCode] as const,
  cart: (qrCode: string) => [...customerKeys.all, 'cart', qrCode] as const,
  details: (qrCode: string) => [...customerKeys.all, 'details', qrCode] as const,
  checkout: (qrCode: string) => [...customerKeys.all, 'checkout', qrCode] as const,
};
