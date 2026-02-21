import { Box, Button, Text, Spinner, Input } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { type AttributeValueInput, useGetVideoPageTypeQuery, useCreateWidgetMutation } from "../../../generated/graphql";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { SH_VIDEO_ATTR_SLUGS, createVideoSlugFromTitle } from "@/lib/shoppable-video";

export default function CreateVideoPage() {
  const router = useRouter();
  const [{ data: typeData, fetching: fetchingTypes }] = useGetVideoPageTypeQuery({
    requestPolicy: "network-only",
  });
  const [, createWidget] = useCreateWidgetMutation();
  
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  if (fetchingTypes) {
    return (
      <Box padding={8} display="flex" justifyContent="center">
        <Spinner />
      </Box>
    );
  }

  if (!typeData?.pageTypes?.edges[0]?.node.id) {
    return (
      <Box padding={8}>
        <Text as="h1" size={7} fontWeight="bold">Video page type not found</Text>
        <Text as="p" color="default2" marginTop={2}>
          Run "One-Click Initialization" on the dashboard page to create required CMS structures.
        </Text>
        <Box marginTop={4}>
          <Button variant="secondary" onClick={() => router.push("/videos")}>Back to Videos</Button>
        </Box>
      </Box>
    );
  }

  const handleCreate = async () => {
    if (!title) return;
    setLoading(true);
    
    // Find page type
    const pageTypeId = typeData?.pageTypes?.edges[0]?.node.id;
    if (!pageTypeId) {
        alert("Video Page Type not found");
        setLoading(false);
        return;
    }

    const slug = createVideoSlugFromTitle(title, Math.random().toString(36).slice(2, 8));
    const attrs = typeData?.pageTypes?.edges[0]?.node.attributes || [];
    const shoppableInfoAttrId = attrs.find((attr) => attr.slug === SH_VIDEO_ATTR_SLUGS.fileInfo)?.id;
    const legacyRulesAttrId = attrs.find((attr) => attr.slug === SH_VIDEO_ATTR_SLUGS.legacyDisplayRules)?.id;
    const attributes: AttributeValueInput[] = [];
    if (shoppableInfoAttrId) {
      attributes.push({
        id: shoppableInfoAttrId,
        plainText: JSON.stringify({
          originalFileName: "",
          uploadedBy: "Dashboard user",
          uploadedAtIso: new Date().toISOString(),
          uploadedAtLabel: "",
          originalFileSizeBytes: 0,
          optimizedFileSizeBytes: 0,
          durationSeconds: 0,
          contentType: "",
          optimizationMode: "lossless_passthrough",
        }),
      });
    }
    if (legacyRulesAttrId) {
      attributes.push({
        id: legacyRulesAttrId,
        plainText: JSON.stringify({ "magic-shoppable-created-manually": true }),
      });
    }

    const result = await createWidget({
      input: {
        title,
        slug,
        pageType: pageTypeId,
        isPublished: true,
        attributes,
      }
    });

    if (result.data?.pageCreate?.page?.id) {
        router.push(`/videos/${result.data.pageCreate.page.id}`);
    } else {
        alert("Error creating video: " + JSON.stringify(result.error || result.data?.pageCreate?.errors));
        setLoading(false);
    }
  };

  return (
    <Box padding={8}>
      <Box marginBottom={6}>
        <Button variant="tertiary" onClick={() => router.push("/videos")} style={{ display: "flex", gap: 8, alignItems: "center", paddingLeft: 0 }}>
            <ArrowLeft size={20} /> Back to Videos
        </Button>
      </Box>

      <Box marginBottom={6}>
        <Text as="h1" size={9} fontWeight="bold">Add New Video</Text>
        <Text as="p" size={3} color="default2" marginTop={2}>Start by giving your video a title.</Text>
      </Box>

      <Box style={{ maxWidth: 600 }}>
            <Box marginBottom={4}>
                <Text as="span" size={2} fontWeight="bold">Video Title</Text>
                <Box marginTop={2}>
                    <Input 
                        value={title} 
                        onChange={e => setTitle(e.target.value)} 
                        placeholder="E.g. Summer Collection Launch" 
                    />
                </Box>
            </Box>

            <Button 
                variant="primary" 
                onClick={handleCreate} 
                disabled={!title || loading}
            >
                {loading ? "Creating..." : "Create Video"}
            </Button>
        </Box>
    </Box>
  );
}
