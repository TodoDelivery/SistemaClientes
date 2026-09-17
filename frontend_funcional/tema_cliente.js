// Tema de Tailwind (CDN) compartido por las páginas de la app de clientes.
// Se carga como script clásico justo después del <script> del CDN de Tailwind (versión fijada en cada página)
tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
      },
      colors: {
        brand: {
          bg: '#090B10',
          surface: '#121620',
          surfaceLight: '#1A202E',
          accent: '#00E58F',
          accentHover: '#00C77B',
          warning: '#FFB800',
          danger: '#FF4D4D',
          info: '#3B82F6',
          textMuted: '#8E9AA8',
          border: '#1F2636'
        }
      }
    }
  }
};
