import { z } from "zod";

export const RadarPrimaryPublicationSchema = z.object({
  id: z.number(),
  subdomain: z.string(),
  name: z.string(),
  custom_domain_optional: z.boolean(),
  author_id: z.number(),
  user_id: z.number(),
  handles_enabled: z.boolean(),
  explicit: z.boolean(),
  is_personal_mode: z.boolean(),
  custom_domain: z.string().optional(),
  logo_url: z.string().optional(),
  language: z.string().optional(),
});

export const RadarPotentialUserSchema = z.object({
  id: z.number(),
  name: z.string(),
  writes: z.string().nullable(),
  is_following: z.boolean(),
  is_subscribed: z.boolean(),
  photo_url: z.string().nullable(),
  bestseller_tier: z.number().nullable(),
  primary_publication: RadarPrimaryPublicationSchema.nullable().optional(),
});

export const RadarPublicProfileSchema = z.object({
  id: z.number().or(z.string()),
  bestseller_tier: z.number().nullable().optional(),
  bio: z.string().nullable().optional(),
  handle: z.string(),
  can_dm: z.boolean().optional(),
  is_following: z.boolean().optional(),
  is_subscribed: z.boolean().optional(),
  name: z.string(),
  photo_url: z.string().nullable(),
  primary_publication: RadarPrimaryPublicationSchema.optional(),
  profile_set_up_at: z.string().optional(),
  rough_num_free_subscribers: z.string().nullable().optional(),
  rough_num_free_subscribers_int: z.number().nullable().optional(),
  slug: z.string(),
  subscriberCount: z.string().nullable().optional(),
  subscriberCountNumber: z.number().nullable().optional(),
  subscriberCountString: z.string().nullable().optional(),
});

export type RadarPrimaryPublicationResponse = z.infer<
  typeof RadarPrimaryPublicationSchema
>;
export type RadarPotentialUserResponse = z.infer<
  typeof RadarPotentialUserSchema
> & {
  subscriberCount?: number;
};
export type RadarPublicProfileResponse = z.infer<
  typeof RadarPublicProfileSchema
>;

export type RadarPotentialUser = ReturnType<
  typeof radarPotentialUserResponseToClient
>;
function radarPrimaryPublicationResponseToClient(
  response: RadarPrimaryPublicationResponse
) {
  return {
    id: response.id,
    subdomain: response.subdomain,
    name: response.name,
    customDomainOptional: response.custom_domain_optional,
    authorId: response.author_id,
    userId: response.user_id,
    handlesEnabled: response.handles_enabled,
    explicit: response.explicit,
    isPersonalMode: response.is_personal_mode,
    customDomain: response.custom_domain,
    logoUrl: response.logo_url,
    language: response.language,
  };
}

// Returns camelCase from snake_case
export function radarPotentialUserResponseToClient(
  response: RadarPotentialUserResponse,
  profile?: RadarPublicProfileResponse
) {
  return {
    id: response.id,
    name: response.name,
    writes: response.writes,
    isFollowing: response.is_following,
    isSubscribed: response.is_subscribed,
    photoUrl: response.photo_url,
    bestsellerTier: response.bestseller_tier,
    subscriberCount: profile?.subscriberCount,
    primaryPublication: response.primary_publication
      ? radarPrimaryPublicationResponseToClient(response.primary_publication)
      : null,
  };
}

export interface BylineDataDb {
  id: bigint;
  bestseller_tier: number | null;
  photo_url: string | null;
  profile_set_up_at: string | null;
  rough_num_free_subscribers: number | null;
  rough_num_free_subscribers_int: number | null;
  slug: string;
  subscriber_count: number | null;
  subscriber_count_number: number | null;
  subscriber_count_string: string | null;
}
