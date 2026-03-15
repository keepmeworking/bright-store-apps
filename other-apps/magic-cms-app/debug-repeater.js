const { createClient, cacheExchange, fetchExchange } = require("@urql/core");
const fetch = require("node-fetch");

const client = createClient({
    url: "https://auth.itcyou.app/graphql/",
    exchanges: [cacheExchange, fetchExchange],
    fetch,
});

async function main() {
    const result = await client.query(`
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
  `, {}).toPromise();

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
