import { Box, ChevronRightIcon, Text, Button } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { ConnectedAddressForm } from "../ui/address-form";
import { trpcClient } from "../../trpc/trpc-client";
import { useDashboardNotification } from "../../../lib/use-dashboard-notifications";
import { Layout } from "../../../components/Layout";

export const ChannelConfigView = () => {
  const {
    push,
    query: { channel },
  } = useRouter();

  const { mutateAsync } =
    trpcClient.appConfiguration.removeChannelOverride.useMutation();
  const { notifySuccess } = useDashboardNotification();

  if (!channel) {
    return null; // TODO: error
  }

  return (
    <Box>
      <Box __marginBottom={"100px"}>
        <Box marginBottom={5} display={"flex"} alignItems={"center"} gap={2}>
          <Text color={"default2"}>Configuration</Text>
          <ChevronRightIcon color={"default2"} />
          <Text color={"default2"}>Edit channel</Text>
          <ChevronRightIcon color={"default2"} />
          <Text>{channel}</Text>
        </Box>
      </Box>
      <Layout.AppSection
        includePadding={true}
        heading={"Shop address per channel"}
        sideContent={
          <Box>
            <Text marginBottom={5} as={"p"}>
              Set custom billing address for{" "}
              <Text fontWeight={"bold"}>{channel}</Text> channel.
            </Text>
            <Button
              variant={"secondary"}
              onClick={() => {
                mutateAsync({ channelSlug: channel as string }).then(() => {
                  notifySuccess(
                    "Success",
                    "Custom address configuration removed",
                  );
                  push("/configuration");
                });
              }}
            >
              Remove and set to default
            </Button>
          </Box>
        }
      >
        <ConnectedAddressForm channelSlug={channel as string} />
      </Layout.AppSection>
    </Box>
  );
};
