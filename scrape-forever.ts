import { db } from "./db";
import { getUrlComponents } from "./utils";
import { fetchAllNoteComments } from "./scrape-notes";
import { populatePublications } from "./scraper";

const getValidUrl = (publication: any) => {
  const subdomain = publication.subdomain; // Never empty in db
  const customDomain = publication.custom_domain || "";
  let validUrl = "";
  if (!subdomain.includes("http")) {
    validUrl = customDomain || `https://${subdomain}.substack.com`;
  } else {
    validUrl = subdomain;
  }
  return validUrl;
};

const verifyAllPublicationsHavePublicationLinks = async () => {
  const publications = await db("publications");
  const publicationLinks = await db("publication_links");
  const publicationIdToPublicationMap = new Map(
    publications.map((publication) => [publication.id, publication])
  );

  const publicationLinkIdToPublicationIdMap = new Map(
    publicationLinks.map((link) => [
      link.id,
      publicationIdToPublicationMap.get(link.id),
    ])
  );

  const publicationsWithoutLinks: { url: string; id: number }[] = [];

  for (const key of publicationLinkIdToPublicationIdMap.keys()) {
    if (!publicationLinkIdToPublicationIdMap.has(key)) {
      publicationsWithoutLinks.push({
        url: getValidUrl(publicationLinkIdToPublicationIdMap.get(key)),
        id: key,
      });
    }
  }

  if (publicationsWithoutLinks.length > 0) {
    await db("publication_links").insert(
      publicationsWithoutLinks.map((publication) => ({
        id: publication.id,
        url: publication.url,
        status: "completed",
      }))
    );
  }
};

export const scrapeForever = async (type: "note" | "post") => {
  let shouldReset = false;
  const statusProcessing = "processing-" + type;
  const columnName =
    type === "note" ? "is_notes_scraping" : "is_posts_scraping";
  while (true) {
    if (shouldReset) {
      await verifyAllPublicationsHavePublicationLinks();
      console.log(
        "[INFO] Resetting all publication links statuses to 'completed'"
      );
      await db("publication_links").update({
        [columnName]: false,
      });
      shouldReset = false;
    }

    while (true) {
      console.log(
        "[INFO] Fetching publication links with status not 'processing'..."
      );
      const publicationsLinks = await db("publication_links")
        .where(columnName, "!=", true)
        .leftJoin("publications", "publications.id", "publication_links.id")
        .select("publications.*", "publication_links.url as url")
        .whereNotNull("publications.id")
        .limit(500);

      if (publicationsLinks.length === 0) {
        console.log(
          "[INFO] No publication links found. Resetting on next loop."
        );
        shouldReset = true;
        break;
      }

      console.log(
        `[INFO] Found ${publicationsLinks.length} publication links. Marking as 'processing'...`
      );
      await db("publication_links")
        .whereIn(
          "id",
          publicationsLinks.map((link) => link.id)
        )
        .update({ [columnName]: true });

      for (const link of publicationsLinks) {
        console.log(
          `[INFO] Processing publication link ID: ${link.id}, URL: ${link.url}`
        );
        const { validUrl } = getUrlComponents(link.url);

        try {
          if (type === "post") {
            console.log(
              `[INFO] Populating publications for URL: ${validUrl}, ID: ${link.id}`
            );
            await populatePublications(validUrl, link.id.toString(), true);
          } else {
            console.log(
              `[INFO] Fetching all note comments for author ID: ${link.author_id}`
            );
            await fetchAllNoteComments(link.author_id);
          }
          console.log(`[SUCCESS] Completed processing for ID: ${link.id}`);
        } catch (error) {
          console.error(
            `[ERROR] Failed processing for ID: ${link.id}, Error:`,
            error
          );
        }
      }
    }
  }
};
