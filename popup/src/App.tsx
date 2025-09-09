import React from "react";
import Layout from "./components/layout";
import StreamInfo from "./components/stream-info";
import { DisplayContextProvider } from "./context/DisplayContext";
import { StreamInfoContextProvider } from "./context/StreamInfoContext";
import { TranslationContextProvider } from "./context/TranslationContext";

const App: React.FC = () => (
  <TranslationContextProvider>
    <DisplayContextProvider>
      <StreamInfoContextProvider>
        <Layout>
          <StreamInfo />
        </Layout>
      </StreamInfoContextProvider>
    </DisplayContextProvider>
  </TranslationContextProvider>
);

export default App;
