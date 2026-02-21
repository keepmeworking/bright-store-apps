import "@saleor/macaw-ui/style";
import "../styles/globals.css";

import { AppBridge, AppBridgeProvider } from "@saleor/app-sdk/app-bridge";
import { RoutePropagator } from "@saleor/app-sdk/app-bridge/next";
import { ThemeProvider } from "@saleor/macaw-ui";
import { AppProps } from "next/app";
import { useEffect } from "react";

import { NoSSRWrapper } from "@/lib/no-ssr-wrapper";
import { ThemeSynchronizer } from "@/lib/theme-synchronizer";
import { GraphQLProvider } from "@/providers/GraphQLProvider";
import { MainLayout } from "@/components/MainLayout";

const appBridgeInstance = typeof window !== "undefined" ? new AppBridge() : undefined;

import { ErrorBoundary } from "@/components/ErrorBoundary";
 
 function NextApp({ Component, pageProps }: AppProps) {
    useEffect(() => {
     const jssStyles = document.querySelector("#jss-server-side");
     if (jssStyles) {
       jssStyles?.parentElement?.removeChild(jssStyles);
     }
   }, []);
 
   return (
     <NoSSRWrapper>
       <ErrorBoundary>
         <AppBridgeProvider appBridgeInstance={appBridgeInstance}>
           <GraphQLProvider>
             <ThemeProvider>
               <ThemeSynchronizer />
               <RoutePropagator />
               <MainLayout>
                 <Component {...pageProps} />
               </MainLayout>
             </ThemeProvider>
           </GraphQLProvider>
         </AppBridgeProvider>
       </ErrorBoundary>
     </NoSSRWrapper>
   );
 }

export default NextApp;
