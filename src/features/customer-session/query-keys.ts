export const customerKeys = {
  all: ['customer'] as const,
  session: (qrCode: string) => [...customerKeys.all, 'session', qrCode] as const,
  menu: (qrCode: string) => [...customerKeys.all, 'menu', qrCode] as const,
};
