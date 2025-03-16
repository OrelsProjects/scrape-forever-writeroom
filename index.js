const { populatePublications } = require("./scraper");
const { db } = require("./db");
const { fetchAllNoteComments } = require("./scrape-notes");
const { extractContent } = require("./utils");
const { scrapeForever } = require("./scrape-forever");

const removeQueryParams = (url) => {
  return url.split("?")[0];
};

const getUrlComponents = (url) => {
  if (!url) {
    return { validUrl: "", mainComponentInUrl: "" };
  }
  let validUrl = url;
  let mainComponentInUrl = "";
  validUrl = removeQueryParams(validUrl);
  console.log("validUrl", validUrl);
  if (validUrl.endsWith("/")) {
    validUrl = validUrl.slice(0, -1);
  }
  if (!validUrl.includes("substack.com")) {
    const startsWithHttps = validUrl.startsWith("https://");
    const startsWithWWW = validUrl.startsWith("www.");
    const startsWithHttpsAndWWW = validUrl.startsWith("https://www.");

    if (!startsWithHttpsAndWWW) {
      if (startsWithWWW) {
        const urlWithoutWWW = validUrl.slice(4);
        validUrl = `https://${validUrl}`;
        mainComponentInUrl = urlWithoutWWW.split(".")[0];
      } else if (startsWithHttps) {
        if (validUrl.split(".").length >= 3) {
          mainComponentInUrl = validUrl.split(".")[1];
        } else {
          validUrl = validUrl.slice(0, 8) + "www." + validUrl.slice(8);
          const urlWithoutWWW = validUrl.slice(12);
          mainComponentInUrl = urlWithoutWWW.split(".")[0];
        }
      } else {
        if (validUrl.split(".").length >= 3) {
          mainComponentInUrl = validUrl.split(".")[1];
        } else {
          mainComponentInUrl = validUrl.split(".")[0];
          validUrl = `https://www.${validUrl}`;
        }
      }
    } else {
      const urlWithoutHttpsWWW = validUrl.slice(12);
      mainComponentInUrl = urlWithoutHttpsWWW.split(".")[0];
    }
  } else {
    const urlNoSubstack = validUrl.slice(0, validUrl.indexOf("substack.com"));
    const urlWithoutHttps = urlNoSubstack.startsWith("https://")
      ? urlNoSubstack.slice(8)
      : urlNoSubstack;
    mainComponentInUrl = urlWithoutHttps.split(".")[0];
  }

  const lastDotIndex = validUrl.lastIndexOf(".");
  const firstSlashAfterLastDot = validUrl.indexOf("/", lastDotIndex);
  if (firstSlashAfterLastDot !== -1) {
    validUrl = validUrl.slice(0, firstSlashAfterLastDot);
  }

  return validUrl.startsWith("https://")
    ? { validUrl, mainComponentInUrl }
    : { validUrl: `https://${validUrl}`, mainComponentInUrl };
};

const createPublication = async (url) => {
  const { validUrl } = getUrlComponents(url);
  const endpoint = `${validUrl}/api/v1/homepage_data`;
  const response = await fetch(endpoint);
  const data = await response.json();
  if (data.newPosts.length === 0) {
    throw new Error("No new posts found for publication: " + validUrl);
  }
  const { image, title, description } = await extractContent(url);
  let publication = null;

  for (const post of data.newPosts) {
    if (publication) break;
    post.publishedBylines?.forEach((byline) => {
      if (publication) return;
      byline.publicationUsers?.forEach((user) => {
        if (publication) return;
        const pub = user.publication;
        if (pub.id === data.newPosts[0].publication_id) {
          publication = pub;
        }
      });
    });
  }

  if (!publication) {
    throw new Error("Publication not found for: " + validUrl);
  }

  const userPublication = {
    id: publication.id,
    name: publication.name,
    subdomain: publication.subdomain,
    custom_domain: publication.custom_domain,
    logo_url: publication.logo_url || image,
    author_id: publication.author_id,
    created_at: publication.created_at,
    language: "en",
    custom_domain_optional: false,
    hero_text: publication.hero_text || description,
    email_from_name: publication.email_from_name || null,
    copyright: publication.copyright || title || "",
    explicit: publication.explicit || false,
  };

  await db("publications").insert(userPublication).onConflict("id").merge();
  return {
    id: String(userPublication.id),
    name: userPublication.name,
    subdomain: userPublication.subdomain,
    custom_domain: userPublication.custom_domain,
    author_id: String(userPublication.author_id),
  };
};

const setPublications = async (url) => {
  const { validUrl, mainComponentInUrl } = getUrlComponents(url);
  let publicationLink = await db("publication_links")
    .select("*")
    .whereILike("url", `%${mainComponentInUrl}%`)
    .first();
  let publication = null;

  if (!publicationLink) {
    publication = await createPublication(url);
    if (publication) {
      await db("publication_links").insert({
        url: validUrl,
        status: "started",
        id: publication.id,
      });
    }
  } else {
    publication = await db("publications")
      .select("*")
      .where("id", publicationLink.id)
      .first();
  }

  if (!publication || publication.name?.toLowerCase() === "unknown") {
    publication = await createPublication(url);
    await db("publication_links")
      .update({ status: "started", id: publication.id })
      .where("id", publicationLink.id);
  }

  const publicationsStatus = await populatePublications(
    validUrl,
    publication?.id
  );
  for (const update of publicationsStatus) {
    await db("publication_links")
      .update({ status: update.status })
      .where("url", update.url);
  }
  return publication;
};

const main = async (event) => {
  try {
    const { url } = event;
    if (!url || typeof url !== "string") {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Invalid input: 'url' must be a string",
        }),
      };
    }
    const publication = await setPublications(url);
    if (publication?.author_id) {
      await fetchAllNoteComments(publication.author_id);
    }
    return { statusCode: 200, body: JSON.stringify({ publication }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

exports.handler = async (event) => main(event);

scrapeForever("note");
