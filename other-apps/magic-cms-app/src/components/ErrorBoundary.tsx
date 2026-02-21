import React, { Component, ErrorInfo, ReactNode } from "react";
import { Box, Text, Button } from "@saleor/macaw-ui";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <Box padding={10} display="flex" flexDirection="column" alignItems="center" justifyContent="center" style={{ minHeight: "100vh" }}>
          <Text size={7} fontWeight="bold" color="critical1" marginBottom={4}>Something went wrong</Text>
          <Box padding={4} backgroundColor="default2" borderRadius={4} marginBottom={6} style={{ maxWidth: "80%", overflow: "auto" }}>
            <Text size={2} color="critical1" style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
              {this.state.error?.toString()}
            </Text>
          </Box>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload Application
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}
