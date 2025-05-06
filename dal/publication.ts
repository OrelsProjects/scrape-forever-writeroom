import { db } from "../db";
import { Publication } from "../scraper";

export async function getAllAuthorPublications(authorId: string): Promise<Publication[]> {
  const bylinePublicationUsers = await db("byline_publication_users")
    .select("publication_id")
    .where("user_id", authorId);

  const publications = await db("publications")
    .select("*")
    .whereIn(
      "id",
      bylinePublicationUsers.map((bylinePublicationUser) => bylinePublicationUser.publication_id)
    );
  return publications;
}
