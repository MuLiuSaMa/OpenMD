import React from "react";
import ReactDOM from "react-dom/client";
import { ChakraProvider } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import { system } from "./theme/theme";
import App from "./App";
import "./i18n";
import LanguageSync from "./components/LanguageSync";
import "./theme/md.css";

// Chakra v3 delegates color mode to next-themes: `attribute="class"` puts the
// `dark` class on <html>, which both Chakra's _dark condition and md.css key on.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ChakraProvider value={system}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <LanguageSync />
        <App />
      </ThemeProvider>
    </ChakraProvider>
  </React.StrictMode>,
);
