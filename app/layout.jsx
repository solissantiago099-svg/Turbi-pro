import "./globals.css";

export const metadata = {
  title: "TAMIZ RUTAS",
  description: "Agenda operativa compartida para rutas, choferes y vehiculos.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09213b",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
