import { populatePublications } from "./scraper";
import { db } from "./db";
import { fetchAllNoteComments } from "./scrape-notes";
import { extractContent, getUrlComponents } from "./utils";
import { scrapeForever } from "./scrape-forever";

interface PublicationDB {
  id: number;
  name: string;
  subdomain: string;
  custom_domain: string;
  custom_domain_optional: boolean;
  hero_text: string;
  logo_url: string;
  email_from_name: string | null;
  copyright: string;
  author_id: number;
  created_at: string;
  language: string;
  explicit: boolean;
}

type Byline = {
  publicationUsers: {
    publication: PublicationDB;
  }[];
};

interface PublicationDataResponse {
  newPosts: {
    id: number;
    publication_id: number;
    title: string;
    social_title: string;
    search_engine_title: string;
    search_engine_description: string;
    slug: string;
    publishedBylines: Byline[];
  }[];
}


interface Publication {
  id: string;
  name?: string;
  subdomain?: string;
  custom_domain?: string;
  author_id?: string;
  [key: string]: any;
}

interface PublicationLink {
  id: string;
  url: string;
  status: string;
  [key: string]: any;
}

interface PublicationStatus {
  url: string;
  status: string;
}

interface LambdaEvent {
  url: string;
  [key: string]: any;
}

interface LambdaResponse {
  statusCode: number;
  body: string;
}

export const createPublication = async (
  url: string
): Promise<Publication | null> => {
  const { validUrl } = getUrlComponents(url);
  const endpoint = `${validUrl}/api/v1/homepage_data`;
  const response = await fetch(endpoint);
  const data = (await response.json()) as PublicationDataResponse;
  if (data.newPosts.length === 0) {
    throw new Error("No new posts found for publication: " + validUrl);
  }
  const { image, title, description } = await extractContent(url);

  let publication: PublicationDB | null = null;
  for (const post of data.newPosts) {
    if (publication) {
      break;
    }
    post.publishedBylines?.forEach((byline) => {
      if (publication) {
        return;
      }
      byline.publicationUsers?.forEach((user) => {
        if (publication) {
          return;
        }
        const pub = user.publication;
        if (pub.id === data.newPosts[0].publication_id) {
          publication = pub;
          return;
        }
      });
    });
  }

  if (!publication) {
    throw new Error("Publication not found for: " + validUrl);
  }

  const pub = publication as PublicationDB;

  const userPublication: PublicationDB = {
    id: pub.id,
    name: pub.name,
    subdomain: pub.subdomain,
    custom_domain: pub.custom_domain,
    logo_url: pub.logo_url || image,
    author_id: pub.author_id,
    created_at: pub.created_at,
    language: "en",
    custom_domain_optional: false,
    hero_text: pub.hero_text || description,
    email_from_name: pub.email_from_name || null,
    copyright: pub.copyright || title || "",
    explicit: pub.explicit || false,
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

const setPublications = async (url: string): Promise<Publication | null> => {
  const { validUrl, mainComponentInUrl } = getUrlComponents(url);

  console.log("Valid URL: ", validUrl);
  console.log("Main component in URL: ", mainComponentInUrl);

  let publicationLink = (await db("publication_links")
    .select("*")
    .whereILike("url", `%${mainComponentInUrl}%`)
    .first()) as PublicationLink;

  let publication: Publication | null = null;

  if (!publicationLink) {
    publication = await createPublication(url);
    if (publication) {
      await db("publication_links").insert({
        url: validUrl,
        status: "started",
        id: publication.id,
      });
      publicationLink = {
        url: validUrl,
        status: "started",
        id: publication.id,
      };
    }
  } else {
    publication = (await db("publications")
      .select("*")
      .where("id", "=", publicationLink?.id)
      .first()) as Publication;
  }

  if (!publication || publication.name?.toLocaleLowerCase() === "unknown") {
    publication = await createPublication(url);
    const pub = publication as Publication;
    // update publication link
    await db("publication_links")
      .update({ status: "started", id: pub.id })
      .where("id", publicationLink.id);
  }

  if (!publicationLink) {
    throw new Error("Publication link not found for: " + validUrl);
  }

  const isCompleted = publicationLink?.status === "completed";

  if (isCompleted) {
    console.log("Publication completed: ", publication);
    return publication;
  }

  if (publicationLink) {
    await db("publication_links")
      .update({ status: "started" })
      .where("id", publicationLink.id);
  } else {
    const insertedIds = await db("publication_links").insert({
      url: validUrl,
      status: "started",
    });

    publicationLink = {
      id: String(insertedIds[0]),
      url: validUrl,
      status: "started",
    };
  }

  console.log("About to populate publication");
  const publicationsStatus = await populatePublications(
    validUrl,
    publication ? publication.id : undefined
  );
  console.log(publicationsStatus);

  const publicationsUpdate = publicationsStatus.map(
    (status: PublicationStatus) => ({
      url: status.url,
      completed_at:
        status.status === "completed" ? new Date().toISOString() : null,
      status: status.status,
    })
  );

  for (const update of publicationsUpdate) {
    await db("publication_links")
      .update({ status: update.status })
      .where("url", update.url);
  }

  console.log("Publication: ", publication);
  return publication;
};

const main = async (event: LambdaEvent): Promise<LambdaResponse> => {
  try {
    const url = event.url;

    if (!url || typeof url !== "string") {
      console.error("Invalid input: 'url' must be a string");
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Invalid input: 'url' must be a string",
        }),
      };
    }

    console.log("Fetching publication for", url);

    const publication = await setPublications(url);

    console.log("Publication: ", publication);

    if (publication) {
      if (publication.author_id) {
        console.log("Fetching notes for", publication.author_id);
        await fetchAllNoteComments(publication.author_id);
        console.log(
          "Notes fetched and inserted to db for",
          publication.author_id
        );
      } else {
        console.log("No author id for", publication.id);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ publication }),
    };
  } catch (error: any) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

// Lambda Handler
exports.handler = async (event: LambdaEvent): Promise<LambdaResponse> =>
  main(event);

// // For local testing
// main({
//   url: "https://giacomofalcone.substack.com/",
// });

// scrapeForever("post");
scrapeForever("note");

// For AWS Lambda
// export { handler };
