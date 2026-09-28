// Tema de Tailwind (CDN) compartido por las páginas de la app de clientes TodoDelivery.
// Se alinea con la identidad estética de index.html (Naranja #FF5A1F, blanco y superficies limpias).
tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      colors: {
        brand: {
          bg: '#F8FAFC',
          surface: '#FFFFFF',
          surfaceLight: '#F1F5F9',
          surfaceHover: '#E2E8F0',
          accent: '#FF5A1F',
          accentHover: '#E14A0F',
          accentLight: '#FFF2EB',
          dark: '#111827',
          ink: '#1A1A1A',
          warning: '#F59E0B',
          warningLight: '#FEF3C7',
          danger: '#EF4444',
          dangerLight: '#FEE2E2',
          success: '#00897B',
          successLight: '#E6F4F1',
          info: '#1E88E5',
          infoLight: '#EFF6FF',
          textMuted: '#6B7280',
          border: '#E5E7EB',
          borderFocus: '#CBD5E1'
        }
      },
      boxShadow: {
        card: '0 4px 16px rgba(0, 0, 0, 0.06)',
        'card-hover': '0 6px 20px rgba(0, 0, 0, 0.09)',
        btn: '0 4px 14px rgba(255, 90, 31, 0.28)',
        'btn-hover': '0 6px 18px rgba(255, 90, 31, 0.35)'
      }
    }
  }
};

