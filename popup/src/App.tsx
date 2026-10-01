// The panel's root component, which index.tsx renders in the iframe.
import React from "react";
import Layout from "./components/layout";
import StreamInfo from "./components/stream-info";
import { DisplayContextProvider } from "./context/DisplayContext";
import { FpsContextProvider } from "./context/FpsContext";
import { ReportContextProvider } from "./context/ReportContext";
import { SessionContextProvider } from "./context/SessionContext";
import { TimelineContextProvider } from "./context/TimelineContext";
import { TranslationContextProvider } from "./context/TranslationContext";

// The contexts of the panel's state around the layout; the layout shows StreamInfo (the tiles) in Compact and Mini.
const App: React.FC = () => (
  <TranslationContextProvider>
    <DisplayContextProvider>
      <SessionContextProvider>
        <FpsContextProvider>
          <TimelineContextProvider>
            <ReportContextProvider>
              <Layout>
                <StreamInfo />
              </Layout>
            </ReportContextProvider>
          </TimelineContextProvider>
        </FpsContextProvider>
      </SessionContextProvider>
    </DisplayContextProvider>
  </TranslationContextProvider>
);

export default App;
