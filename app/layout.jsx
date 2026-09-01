import "./globals.css";
import PwaRegister from "./PwaRegister";

export const metadata = {
  title: "TAMIZ RUTAS",
  description: "Agenda operativa compartida para rutas, choferes y vehiculos.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "TAMIZ RUTAS",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09213b",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
