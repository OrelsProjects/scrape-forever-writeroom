import { db } from "./db";
import { fetchWithHeaders, scrapeArticles } from "./utils";

const step = 23;
const allowedPostFields = [
  "id",
  "publication_id",
  "title",
  "social_title",
  "search_engine_title",
  "search_engine_description",
  "slug",
  "post_date",
  "audience",
  "canonical_url",
  "reactions",
  "subtitle",
  "cover_image",
  "cover_image_is_square",
  "cover_image_is_explicit",
  "description",
  "body_json",
  "body_text",
  "truncated_body_text",
  "wordcount",
  "postTags",
  "reaction",
  "reaction_count",
  "comment_count",
  "child_comment_count",
  "hidden",
  "explicit",
  "email_from_name",
  "is_guest",
  "bestseller_tier",
  "podcast_episode_image_info",
];

const mergePostFields = [
  "title",
  "social_title",
  "search_engine_title",
  "search_engine_description",
  "slug",
  "post_date",
  "audience",
  "canonical_url",
  "reactions",
  "subtitle",
  "cover_image",
  "cover_image_is_square",
  "cover_image_is_explicit",
  "description",
  "body_json",
  "truncated_body_text",
  "wordcount",
  "postTags",
  "reaction",
  "reaction_count",
  "comment_count",
  "child_comment_count",
  "hidden",
  "explicit",
  "email_from_name",
  "is_guest",
  "bestseller_tier",
  "podcast_episode_image_info",
];

// Define interfaces for our data structures
interface Post {
  id: string;
  publication_id: string;
  title?: string;
  social_title?: string;
  search_engine_title?: string;
  search_engine_description?: string;
  slug?: string;
  post_date?: string;
  audience?: string;
  canonical_url?: string;
  reactions?: any;
  subtitle?: string;
  cover_image?: string;
  cover_image_is_square?: boolean;
  cover_image_is_explicit?: boolean;
  description?: string;
  body_json?: any;
  body_text?: string;
  truncated_body_text?: string;
  wordcount?: number;
  postTags?: any[];
  reaction?: any;
  reaction_count?: number;
  comment_count?: number;
  child_comment_count?: number;
  hidden?: boolean;
  explicit?: boolean;
  email_from_name?: string;
  is_guest?: boolean;
  bestseller_tier?: string;
  podcast_episode_image_info?: any;
  publishedBylines?: Byline[];
  audio_items?: AudioItem[];
  podcastFields?: PodcastField;
  [key: string]: any;
}

export interface Publication {
  id: string;
  name: string;
  subdomain: string;
  custom_domain: string;
  custom_domain_optional: boolean;
  hero_text: string;
  logo_url: string;
  author_id?: string;
  theme_var_background_pop: string;
  created_at?: string;
  rss_website_url?: string;
  email_from_name?: string;
  copyright?: string;
  founding_plan_name: string | null;
  community_enabled: boolean;
  invite_only: boolean;
  payments_state: string;
  language: string | null;
  explicit: boolean;
  is_personal_mode: boolean;
}

interface Byline {
  id: string;
  name: string;
  handle: string;
  previous_name?: string;
  photo_url?: string;
  bio?: string;
  profile_set_up_at?: string;
  twitter_screen_name?: string;
  is_guest?: boolean;
  bestseller_tier?: string;
  publicationUsers?: PublicationUser[];
}

interface PublicationUser {
  id: string;
  user_id: string;
  publication_id: string;
  role: string;
  public: boolean;
  is_primary: boolean;
  byline_id?: string;
  publication?: Publication;
}

interface AudioItem {
  post_id: string;
  voice_id: string;
  audio_url: string;
  type: string;
  status: string;
}

interface PodcastField {
  post_id: string;
  podcast_episode_number?: number;
  podcast_season_number?: number;
  podcast_episode_type?: string;
  should_syndicate_to_other_feed: boolean;
  syndicate_to_section_id?: string;
  hide_from_feed: boolean;
  free_podcast_url?: string;
  free_podcast_duration?: number;
}

interface PostByline {
  post_id: string;
  byline_id: string;
}

interface DbRows {
  publications: Publication[];
  posts: Post[];
  bylines: Byline[];
  postBylines: PostByline[];
  bylinePublicationUsers: PublicationUser[];
  audioItems: AudioItem[];
  podcastFields: PodcastField[];
}

interface PublicationStatus {
  url: string;
  status: string;
}

interface ValidationResult {
  shouldScrape: boolean;
}

const filterPost = (post: Post): Post =>
  allowedPostFields.reduce((acc: Post, key: string) => {
    if (key in post) {
      acc[key] = post[key];
    }
    return acc;
  }, {} as Post);

async function insertInBatches(
  table: string,
  data: any[],
  batchSize: number = 100,
  trx: any,
  mergeFields?: string[]
): Promise<void> {
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    const fields = mergeFields
      ? mergeFields.length > 0
        ? mergeFields
        : "*"
      : "*";

    for (const item of batch) {
      await trx(table)
        .insert(item)
        .onConflict("id") // Assuming `id` is the primary key
        .merge(fields);
    }
  }
}

/**
 * Return object containing arrays ready to insert into your DB tables.
 */
function convertPostsToDbRows(posts: Post[]): DbRows {
  // Use maps/sets to ensure uniqueness
  const publicationMap = new Map<string, Publication>();
  const bylineMap = new Map<string, Byline>();

  const publicationUsersRows: PublicationUser[] = [];
  const postRows: Post[] = [];
  const postBylineRows: PostByline[] = [];
  const audioRows: AudioItem[] = [];
  const podcastFieldsRows: PodcastField[] = [];

  for (const item of posts) {
    // 1) Publications
    const pubId = item.publication_id;
    let publication: Publication | null = null;
    let publicationUser: PublicationUser | null = null;
    if (
      !publicationMap.has(pubId) ||
      publicationMap.get(pubId)?.name === "Unknown"
    ) {
      const publishedBylines = item.publishedBylines;
      if (publishedBylines && publishedBylines.length > 0) {
        for (const byline of publishedBylines) {
          const publicationUsers = byline.publicationUsers;
          if (publicationUsers && publicationUsers.length > 0) {
            for (const pu of publicationUsers) {
              if (pu.publication?.id === pubId) {
                publication = pu.publication;
                publicationUser = pu;
                break;
              }
            }
          }
          if (publication) {
            break;
          }
        }
      }

      publicationMap.set(pubId, {
        id: pubId,
        name: publication?.name || "Unknown",
        subdomain: publication?.subdomain || "",
        custom_domain:
          publication?.custom_domain ||
          (publication?.subdomain
            ? `https://${publication.subdomain}.substack.com`
            : ""),
        custom_domain_optional: publication?.custom_domain_optional || false,
        hero_text: publication?.hero_text || "",
        logo_url: publication?.logo_url || "",
        author_id: publicationUser?.user_id,
        theme_var_background_pop: publication?.theme_var_background_pop || "",
        created_at: publication?.created_at,
        rss_website_url: publication?.rss_website_url,
        email_from_name: publication?.email_from_name,
        copyright: publication?.copyright,
        founding_plan_name: null,
        community_enabled: false,
        invite_only: false,
        payments_state: "disabled",
        language: null,
        explicit: false,
        is_personal_mode: false,
      });
    }

    // 2) Post rows
    postRows.push({
      ...filterPost(item),
      postTags: [],
    });

    // 3) Byline rows
    if (Array.isArray(item.publishedBylines)) {
      for (const byline of item.publishedBylines) {
        if (!bylineMap.has(byline.id)) {
          bylineMap.set(byline.id, {
            id: byline.id,
            name: byline.name,
            handle: byline.handle,
            previous_name: byline.previous_name,
            photo_url: byline.photo_url,
            bio: byline.bio,
            profile_set_up_at: byline.profile_set_up_at,
            twitter_screen_name: byline.twitter_screen_name,
            is_guest: byline.is_guest,
            bestseller_tier: byline.bestseller_tier,
          });
        }
        // 4) post_bylines pivot
        postBylineRows.push({
          post_id: item.id,
          byline_id: byline.id,
        });

        // 5) byline_publication_users
        if (Array.isArray(byline.publicationUsers)) {
          for (const pu of byline.publicationUsers) {
            publicationUsersRows.push({
              id: pu.id,
              user_id: pu.user_id,
              publication_id: pu.publication_id,
              role: pu.role,
              public: pu.public,
              is_primary: pu.is_primary,
              byline_id: byline.id,
            });
          }
        }
      }
    }

    // 6) audio_items
    if (Array.isArray(item.audio_items)) {
      for (const audio of item.audio_items) {
        audioRows.push({
          // id is auto-increment, so skip or set to undefined
          post_id: audio.post_id,
          voice_id: audio.voice_id,
          audio_url: audio.audio_url,
          type: audio.type,
          status: audio.status,
        });
      }
    }

    // 7) podcast_fields
    if (item.podcastFields) {
      const pf = item.podcastFields;
      podcastFieldsRows.push({
        post_id: pf.post_id,
        podcast_episode_number: pf.podcast_episode_number,
        podcast_season_number: pf.podcast_season_number,
        podcast_episode_type: pf.podcast_episode_type,
        should_syndicate_to_other_feed: !!pf.should_syndicate_to_other_feed,
        syndicate_to_section_id: pf.syndicate_to_section_id,
        hide_from_feed: pf.hide_from_feed ?? false,
        free_podcast_url: pf.free_podcast_url,
        free_podcast_duration: pf.free_podcast_duration,
      });
    }
  }

  return {
    publications: Array.from(publicationMap.values()),
    posts: postRows,
    bylines: Array.from(bylineMap.values()),
    postBylines: postBylineRows,
    bylinePublicationUsers: publicationUsersRows,
    audioItems: audioRows,
    podcastFields: podcastFieldsRows,
  };
}

const publicationsSuffix = (offset: number, limit: number): string =>
  `api/v1/archive?sort=new&search=&offset=${offset}&limit=${limit}`;

async function validatePublicationNeedsScrapeArticles(
  publication_id?: string
): Promise<ValidationResult> {
  if (!publication_id) {
    return { shouldScrape: true };
  }
  const publication = await db("publications")
    .where("id", "=", parseInt(publication_id))
    .first();

  if (!publication) {
    return { shouldScrape: true };
  }

  return { shouldScrape: true };
}

async function populatePublications(
  url: string,
  publication_id?: string,
  force_scrape?: boolean
): Promise<PublicationStatus[]> {
  let allPosts: Post[] = [];
  const publicationsStatus: PublicationStatus[] = [];

  const { shouldScrape } = await validatePublicationNeedsScrapeArticles(
    publication_id
  );

  if (!shouldScrape && !force_scrape) {
    return publicationsStatus;
  }

  for (let i = 0; i < 9999; i += step) {
    if (i > 0 && i % 600 === 0) {
      console.log(`Waiting 1 minute after ${i} posts`);
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
    if (url.includes("http://")) {
      url = url.replace("http://", "https://");
    }
    const posts = await fetchWithHeaders<Post[]>(
      `${url}/${publicationsSuffix(i, step)}`
    );

    if (!posts) {
      break;
    }

    if (posts.length === 0) {
      // No new posts, break
      console.log("No new posts, breaking");
      break;
    }
    allPosts.push(...posts);
    if (posts.length !== posts.length) {
      break;
    }
  }

  /** Scrape articles body */
  const maxInParallel = 10;
  const chunks: Post[][] = [];
  // Filter out posts that are older than 2 weeks
  for (let i = 0; i < allPosts.length; i += maxInParallel) {
    chunks.push(allPosts.slice(i, i + maxInParallel));
  }
  for (const chunk of chunks) {
    const bodies = await Promise.all(
      chunk.map((post) => scrapeArticles(post.canonical_url || ""))
    );
    for (let i = 0; i < chunk.length; i++) {
      chunk[i].body_text = bodies[i];
    }
  }

  const publicationItems = convertPostsToDbRows(allPosts);
  const formattedPosts = publicationItems.posts.map((post) => ({
    ...post,
  }));

  const uniqueBylinePublicationUsers = Array.from(
    new Map(
      publicationItems.bylinePublicationUsers.map((bpu) => [
        `${bpu.byline_id}-${bpu.publication_id}-${bpu.user_id}`,
        bpu,
      ])
    ).values()
  );

  try {
    console.log("Starting DB writes", publicationItems.publications.length);
    console.time("populatePublications - db");
    // DB writes
    await db.transaction(async (trx: any) => {
      await insertInBatches(
        "publications",
        publicationItems.publications,
        100,
        trx
      );
      await insertInBatches("bylines", publicationItems.bylines, 100, trx);
      await insertInBatches("posts", formattedPosts, 100, trx, mergePostFields);
      await insertInBatches(
        "post_bylines",
        publicationItems.postBylines,
        100,
        trx
      );
      await insertInBatches(
        "byline_publication_users",
        uniqueBylinePublicationUsers,
        100,
        trx
      );
      await insertInBatches(
        "audio_items",
        publicationItems.audioItems,
        100,
        trx
      );
      await insertInBatches(
        "podcast_fields",
        publicationItems.podcastFields,
        100,
        trx
      );
    });
    console.timeEnd("populatePublications - db");
    publicationsStatus.push({
      url,
      status: "completed",
    });
  } catch (error: any) {
    publicationsStatus.push({
      url,
      status: "failed",
    });
    console.log("Failed to populate publications", error.message, error.where);
  }

  return publicationsStatus;
}

export { populatePublications, convertPostsToDbRows };
