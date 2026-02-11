import { NextPage } from "next";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { actions, useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Text, Spinner } from "@saleor/macaw-ui";
import { trpcClient } from "../modules/trpc/trpc-client";
import { useDashboardNotification } from "../lib/use-dashboard-notifications";

const OrderDetailsActionPage: NextPage = () => {
  const { appBridge, appBridgeState } = useAppBridge();
  const { query } = useRouter();
  const { notifySuccess, notifyError } = useDashboardNotification();
  const [isGenerated, setIsGenerated] = useState(false);

  const orderId = query.id as string;

  const { mutate, isLoading, error } = trpcClient.invoices.generateInvoice.useMutation({
    onSuccess: () => {
      notifySuccess("Invoice generated successfully");
      setIsGenerated(true);
      
      // Refresh the Dashboard to show the new invoice
      // This is a common pattern to trigger data refresh in Saleor Dashboard
      appBridge?.dispatch(
        actions.Notification({
          status: "success",
          title: "Refreshing Dashboard...",
        })
      );

      // Give Saleor a moment to process the mutation before refreshing
      setTimeout(() => {
        appBridge?.dispatch(
          actions.Redirect({
            to: `/orders/${orderId}`,
          })
        );
      }, 1500);
    },
    onError: (err) => {
      notifyError("Failed to generate invoice", err.message);
    }
  });

  useEffect(() => {
    if (orderId && !isGenerated && !isLoading && !error) {
      mutate({ orderId });
    }
  }, [orderId, mutate, isGenerated, isLoading, error]);

  if (!appBridgeState) {
    return null;
  }

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      padding={10}
      height="100%"
    >
      {!isGenerated ? (
        <>
          <Box marginBottom={4}>
            <Spinner />
          </Box>
          <Text size={5} fontWeight="bold">
            Generating Invoice...
          </Text>
          <Text size={3} color="default2" marginTop={2}>
            Please wait while we prepare your PDF.
          </Text>
        </>
      ) : (
        <>
          <Text size={5} fontWeight="bold" color="success1" marginBottom={4}>
            Done!
          </Text>
          <Text size={3} marginBottom={6} textAlign="center">
            The invoice has been generated and uploaded. <br />
            The dashboard will refresh automatically.
          </Text>
          <Button
            onClick={() => {
              appBridge?.dispatch(
                actions.Redirect({
                  to: `/orders/${orderId}`,
                })
              );
            }}
          >
            Back to Order
          </Button>
        </>
      )}
      
      {error && (
        <Box marginTop={6} textAlign="center">
          <Text color="critical1" marginBottom={4}>
            {error.message}
          </Text>
          <Button onClick={() => mutate({ orderId })}>Retry</Button>
        </Box>
      )}
    </Box>
  );
};

export default OrderDetailsActionPage;
