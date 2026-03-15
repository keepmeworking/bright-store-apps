async function main() {
    const query = `
    query {
      pages(first: 10, filter: { pageTypes: ["magiccms-widget-repeater-hero-s-1z8bch"] }) {
        edges {
          node {
            id
            title
            attributes {
              attribute {
                slug
                inputType
              }
              values {
                name
                value
                richText
                plainText
                file {
                  url
                }
              }
            }
          }
        }
      }
    }
  `;

    const res = await fetch("http://localhost:8000/graphql/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
    });
    const result = await res.json();

    const pages = result.data?.pages?.edges || [];
    for (const p of pages) {
        console.log("Widget:", p.node.title);
        for (const attr of p.node.attributes) {
            if (attr.attribute.slug.startsWith("magic-json")) {
                console.log("  Repeater Attr:", attr.attribute.slug);
                console.log("  Values:", JSON.stringify(attr.values, null, 2));
            }
        }
    }
}

main().catch(console.error);
