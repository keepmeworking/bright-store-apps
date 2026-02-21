import { Box, Button, Text, Spinner, Input } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import {
  AttributeValueInput,
  useGetReviewPageTypeQuery,
  useCreateWidgetMutation,
} from "../../../generated/graphql";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";

export default function CreateReviewPage() {
  const router = useRouter();
  const [{ data: typeData, fetching: fetchingTypes }] = useGetReviewPageTypeQuery({
    requestPolicy: "network-only",
  });
  const [createResult, createWidget] = useCreateWidgetMutation();
  
  const [title, setTitle] = useState("");
  const [rating, setRating] = useState("5");
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
        <Text as="h1" size={7} fontWeight="bold">Review page type not found</Text>
        <Text as="p" color="default2" marginTop={2}>
          Run "One-Click Initialization" on the dashboard page to create required CMS structures.
        </Text>
        <Box marginTop={4}>
          <Button variant="secondary" onClick={() => router.push("/reviews")}>Back to Reviews</Button>
        </Box>
      </Box>
    );
  }

  const handleCreate = async () => {
    if (!title) return;
    setLoading(true);
    
    const pageTypeId = typeData?.pageTypes?.edges[0]?.node.id;
    if (!pageTypeId) {
        alert("Review Page Type not found");
        setLoading(false);
        return;
    }

    // Generate a simple slug
    const slug = "review-" + Date.now();

    // Need to find attribute IDs for rating, status, content
    const attributes = typeData?.pageTypes?.edges[0]?.node.attributes || [];
    const ratingAttrId = attributes.find(a => a.slug === "magic-rating")?.id;
    const statusAttrId = attributes.find(a => a.slug === "magic-status")?.id;
    // content is page title? or rich text? "magic-widget-data" isn't on review.
    // Review has: rating, status, linked-products, media.
    // Title is the review title. Content is... where? Maybe just title for now.
    
    const attrInput: AttributeValueInput[] = [];
    if (ratingAttrId) {
      attrInput.push({ id: ratingAttrId, numeric: rating });
    }
    if (statusAttrId) {
      attrInput.push({ id: statusAttrId, dropdown: { value: "pending" } });
    }

    const result = await createWidget({
      input: {
        title,
        slug,
        pageType: pageTypeId,
        isPublished: true,
        attributes: attrInput
      }
    });

    if (result.data?.pageCreate?.page?.id) {
        router.push("/reviews");
    } else {
        alert("Error creating review: " + JSON.stringify(result.error || result.data?.pageCreate?.errors));
        setLoading(false);
    }
  };

  return (
    <Box padding={8}>
      <Box marginBottom={6}>
        <Button variant="tertiary" onClick={() => router.push("/reviews")} style={{ display: "flex", gap: 8, alignItems: "center", paddingLeft: 0 }}>
            <ArrowLeft size={20} /> Back to Reviews
        </Button>
      </Box>

      <Box marginBottom={6}>
        <Text as="h1" size={9} fontWeight="bold">Create Test Review</Text>
      </Box>

      <Box style={{ maxWidth: 600 }}>
            <Box marginBottom={4}>
                <Text as="span" size={2} fontWeight="bold">Summary / Title</Text>
                <Box marginTop={2}>
                    <Input 
                        value={title} 
                        onChange={e => setTitle(e.target.value)} 
                        placeholder="Great product!" 
                    />
                </Box>
            </Box>

            <Box marginBottom={4}>
                <Text as="span" size={2} fontWeight="bold">Rating (1-5)</Text>
                 <Box marginTop={2}>
                    <select 
                        value={rating} 
                        onChange={e => setRating(e.target.value)}
                        style={{ padding: 8, borderRadius: 4, width: "100%", borderColor: "#E6E6E6" }}
                    >
                        <option value="1">1 Star</option>
                        <option value="2">2 Stars</option>
                        <option value="3">3 Stars</option>
                        <option value="4">4 Stars</option>
                        <option value="5">5 Stars</option>
                    </select>
                </Box>
            </Box>

            <Button 
                variant="primary" 
                onClick={handleCreate} 
                disabled={!title || loading}
            >
                {loading ? "Creating..." : "Submit Review"}
            </Button>
        </Box>
    </Box>
  );
}
