import { db } from "../db";
import slugify from "slugify";
import { fetchWithHeaders } from "../utils";
import {
  BylineDataDb,
  RadarPublicProfileResponse,
  RadarPublicProfileSchema,
} from "../types/byline";
// A B C -> a-b-c. A B C DEFG.COM -> a-b-c-defgcom
const nameToSlug = (name: string) => {
  try {
    return slugify(name, { lower: true, strict: true });
  } catch (error) {
    return name;
  }
};

// A B C -> abc
// A B C DEFG.COM -> abc-defgcom
const nameToSlugSecondary = (handle: string) => {
  try {
    const slug = nameToSlug(handle);
    return slug.replace(/-/g, "");
  } catch (error) {
    return handle;
  }
};

export async function scrapeForeverBylines() {
  const batchSize = 1000;
  let currentPage = 70;

  while (true) {
    const bylines = await db("bylines")
      .select("id", "name", "handle")
      .limit(batchSize)
      .offset(currentPage * batchSize);

    console.log("About to insert, page: ", currentPage);

    if (bylines.length === 0) {
      console.log("Finished a run, waiting 12 hours for the next one");
      await new Promise((resolve) => setTimeout(resolve, 12 * 60 * 60 * 1000));
      console.log("Woke up after 12 hours, starting over");
      currentPage = 0;
      continue;
    }

    const profiles: RadarPublicProfileResponse[] = [];

    for (const byline of bylines) {
      const slug = nameToSlug(byline.name);
      let profileResponse = await fetchWithHeaders(
        `https://substack.com/api/v1/reader/feed/profile/${byline.id}`,
        3,
        200
      );
      let parsedProfile = RadarPublicProfileSchema.safeParse(profileResponse);
      if (!parsedProfile.success) {
        profileResponse = await fetchWithHeaders(
          `https://substack.com/api/v1/user/${nameToSlugSecondary(
            byline.handle
          )}/public_profile`
        );
        parsedProfile = RadarPublicProfileSchema.safeParse(profileResponse);
        if (!parsedProfile.success) {
          const finalSlug = nameToSlugSecondary(byline.name);
          profileResponse = await fetchWithHeaders(
            `https://substack.com/api/v1/user/${finalSlug}/public_profile`
          );
          parsedProfile = RadarPublicProfileSchema.safeParse(profileResponse);
          if (!parsedProfile.success) {
            const bylineFailed = await db("bylines")
              .where("id", "=", byline.id)
              .first();
            console.log("Byline failed: ", bylineFailed);
            continue;
          }
        }
      }

      const profile = parsedProfile.data;
      profiles.push(profile);
    }

    const bylinesData: BylineDataDb[] = profiles.map((profile) => {
      let validSubscriberCount: number | null =
        profile.subscriberCount != null ? Number(profile.subscriberCount) : NaN;

      validSubscriberCount = isNaN(validSubscriberCount)
        ? null
        : validSubscriberCount;

      return {
        id: BigInt(profile.id),
        slug: profile.slug,
        subscriber_count: validSubscriberCount,
        subscriber_count_number: profile.subscriberCountNumber ?? null,
        subscriber_count_string: profile.subscriberCountString ?? null,
        bestseller_tier: profile.bestseller_tier ?? null,
        photo_url: profile.photo_url,
        profile_set_up_at: profile.profile_set_up_at ?? null,
        rough_num_free_subscribers:
          profile.rough_num_free_subscribers != null
            ? Number(profile.rough_num_free_subscribers)
            : null,
        rough_num_free_subscribers_int:
          profile.rough_num_free_subscribers_int ?? null,
      };
    });

    const uniqueBylinesData = bylinesData.filter(
      (byline, index, self) =>
        index === self.findIndex((t) => t.id === byline.id)
    );

    await db("byline_data").insert(uniqueBylinesData).onConflict("id").merge();

    console.log(`Inserted ${uniqueBylinesData.length} bylines`);

    currentPage++;
  }
}

