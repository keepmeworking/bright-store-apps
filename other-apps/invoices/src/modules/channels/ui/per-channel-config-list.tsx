import { Box, Text, Chip, Button } from "@saleor/macaw-ui";
import { trpcClient } from "../../trpc/trpc-client";
import { useRouter } from "next/router";
import { SkeletonLayout } from "../../../components/SkeletonLayout";

const defaultAddressChip = (
  <Chip __display={"inline-block"} size={"large"}>
    <Text size={2} color={"default2"}>
      Default
    </Text>
  </Chip>
);

export const PerChannelConfigList = () => {
  const shopChannelsQuery = trpcClient.channels.fetch.useQuery();
  const channelsOverridesQuery =
    trpcClient.appConfiguration.fetchChannelsOverrides.useQuery();

  const { push } = useRouter();

  if (shopChannelsQuery.isLoading || channelsOverridesQuery.isLoading) {
    return <SkeletonLayout.Section />;
  }

  const renderChannelAddress = (slug: string) => {
    const overridesDataRecord = channelsOverridesQuery.data;

    if (!overridesDataRecord) {
      return null; // todo should throw
    }

    if (overridesDataRecord[slug]) {
      const address = overridesDataRecord[slug];

      /**
       * TODO extract address rendering
       */
      return (
        <Box>
          <Text size={2} as={"p"}>
            {address.companyName}
          </Text>
          <Text size={2} as={"p"}>
            {address.streetAddress1}
          </Text>
          <Text size={2} as={"p"}>
            {address.streetAddress2}
          </Text>
          <Text size={2}>
            {address.postalCode} {address.city}
          </Text>
          <Text size={2} as={"p"}>
            {address.country}
          </Text>
        </Box>
      );
    } else {
      return defaultAddressChip;
    }
  };

  const renderActionButtonAddress = (slug: string) => {
    const overridesDataRecord = channelsOverridesQuery.data;

    if (!overridesDataRecord) {
      return null; // todo should throw
    }

    return (
      <Button
        variant={"tertiary"}
        onClick={() => {
          push(`/configuration/${slug}`);
        }}
      >
        <Text color={"default2"} size={2}>
          {overridesDataRecord[slug] ? "Edit" : "Set custom"}
        </Text>
      </Button>
    );
  };

  return (
    <Box>
      <Box display={"grid"} gridTemplateColumns={3} marginBottom={5}>
        <Text color={"default2"} size={2}>
          Channel
        </Text>
        <Text color={"default2"} size={2}>
          Address
        </Text>
      </Box>
      {shopChannelsQuery.data?.map((channel) => (
        <Box
          key={channel.id}
          display={"grid"}
          gridTemplateColumns={3}
          paddingY={1.5}
          borderBottomStyle={"solid"}
          borderBottomWidth={1}
          borderColor={"default1"}
        >
          <Text fontWeight={"bold"}>{channel.name}</Text>
          <Box>{renderChannelAddress(channel.slug)}</Box>
          <Box marginLeft={"auto"}>
            {" "}
            {renderActionButtonAddress(channel.slug)}
          </Box>
        </Box>
      ))}
    </Box>
  );
};
