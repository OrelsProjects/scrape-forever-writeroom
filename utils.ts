import axios from "axios";
import * as cheerio from "cheerio";

interface UrlComponents {
  validUrl: string;
  mainComponentInUrl: string;
}

// Helper function to add a random delay (between 100ms - 600ms)
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// List of rotating User-Agents
const userAgents: string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/110.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Version/16.1 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1",
];

// Function to get a random User-Agent
function getRandomUserAgent(): string {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Fetch a URL with rotating User-Agent and retries
async function fetchWithHeaders<T>(
  url: string,
  retries: number = 3,
  minDelay: number = 300,
  log: boolean = true
): Promise<T | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (log) {
        console.log(`[Attempt ${attempt}] Fetching: ${url}`);
      }
      const validUrl = url.includes("https") ? url : `https://${url}`;
      const response = await axios.get(validUrl, {
        headers: {
          "User-Agent": getRandomUserAgent(),
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.google.com/",
        },
      });

      const randomDelay = Math.floor(Math.random() * 250) + minDelay;
      await delay(randomDelay);

      return response.data;
    } catch (error: any) {
      console.error(
        `Error fetching ${url} (Attempt ${attempt}):`,
        error.message
      );
      const status = error.response.status;
      if (attempt === retries) return null; // Give up after max retries
      if (status === 429) {
        const timeToWait = 5000 * attempt * attempt;
        console.log(
          `Rate limit exceeded, waiting ${timeToWait} seconds before retrying`
        );
        await delay(timeToWait);
      } else if (status === 404) {
        return null;
      } else {
        await delay(2000 * attempt * attempt); // Exponential backoff delay
      }
    }
  }
  return null;
}

async function scrapeArticles(url: string): Promise<string> {
  try {
    const data = await fetchWithHeaders<string>(url);
    if (!data) {
      return "";
    }

    // Load the HTML into cheerio
    const $ = cheerio.load(data);

    // Target the container that holds the article
    const articleRoot = $(".available-content .body");
    let output = "";

    // Traverse all elements inside
    articleRoot.children().each((_elem: any, elem: any) => {
      const tag = $(elem).prop("tagName")
        ? $(elem).prop("tagName")?.toLowerCase()
        : null;
      const text = $(elem).text().trim();

      // Skip empty text
      if (!text) return;

      switch (tag) {
        case "h1":
          output += `# ${text}\n\n`;
          break;
        case "h2":
          output += `## ${text}\n\n`;
          break;
        case "h3":
          output += `### ${text}\n\n`;
          break;
        case "h4":
          output += `#### ${text}\n\n`;
          break;
        case "ul":
          // For <ul>, we'll grab all <li> within it
          $(elem)
            .find("li")
            .each((_li: any, li: any) => {
              output += `- ${$(li).text().trim()}\n`;
            });
          output += "\n";
          break;
        case "p":
          output += `${text}\n\n`;
          break;
        default:
          // If you want to handle other tags or nested content, do it here.
          // For now, just ignore or handle them in a minimal way:
          // e.g. include them as paragraphs
          if (!["script", "style"].includes(tag || "")) {
            output += `${text}\n\n`;
          }
      }
    });

    return output;
  } catch (err) {
    console.error("Something went wrong:", err);
    return "";
  }
}
/**
 * Strip the URL of the protocol
 * @param url
 * @param options
 * @returns
 */
const stripUrl = (
  url: string,
  options?: {
    removeWww?: boolean;
    removeDotCom?: boolean;
    removeQueryParams?: boolean;
  }
) => {
  let strippedUrl = url.replace("https://", "").replace("http://", "");
  if (strippedUrl.endsWith("/")) {
    strippedUrl = strippedUrl.slice(0, -1);
  }
  if (options?.removeWww) {
    strippedUrl = strippedUrl.replace("www.", "");
  }
  if (options?.removeDotCom) {
    strippedUrl = strippedUrl.replace(".com", "");
  }
  if (options?.removeQueryParams) {
    strippedUrl = strippedUrl.split("?")[0];
  }
  return strippedUrl;
};

export const toValidUrl = (url: string) => {
  const strippedUrl = stripUrl(url);
  return `https://${strippedUrl}`;
};

async function extractContent(url: string) {
  try {
    const validUrl = toValidUrl(url);
    const html = await axios.get(validUrl);
    const $ = cheerio.load(html.data);
    // Extract the first image URL from the <img> tag inside the <picture> element
    const imageUrl = $("picture img").first().attr("src") || "";

    // Find the closest <h1> and <p> tags after the <picture> element
    const pictureElement = $("picture").first();
    const title = pictureElement.nextAll("h1").first().text().trim();
    const description = pictureElement.nextAll("p").first().text().trim();

    return {
      image: imageUrl,
      title,
      description,
    };
  } catch (error: any) {
    throw new Error(
      "The publication was not found. Please check your URL and try again."
    );
  }
}

const removeQueryParams = (url: string) => {
  return url.split("?")[0];
};

export const getUrlComponents = (
  url: string,
  options: {
    withoutWWW?: boolean;
  } = {
    withoutWWW: true,
  }
): UrlComponents => {
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
        const urlWithoutWWW = validUrl.slice(4, validUrl.length);
        validUrl = `https://${validUrl}`;
        // remove www. from the url
        mainComponentInUrl = urlWithoutWWW.split(".")[0];
      } else if (startsWithHttps) {
        // if has 3 components, for example read.abc.com, no need www.
        if (validUrl.split(".").length >= 3) {
          // the main is the second one
          mainComponentInUrl = validUrl.split(".")[1];
        } else {
          validUrl =
            validUrl.slice(0, 8) + "www." + validUrl.slice(8, validUrl.length);
          // remove https://www. from the url
          const urlWithoutWWW = validUrl.slice(12, validUrl.length);
          mainComponentInUrl = urlWithoutWWW.split(".")[0];
        }
      } else {
        // Doesn't start with https://www.
        // if has 3 components, for example read.abc.com, no need www.
        if (validUrl.split(".").length >= 3) {
          mainComponentInUrl = validUrl.split(".")[1];
        } else {
          mainComponentInUrl = validUrl.split(".")[0];
          validUrl = `https://www.${validUrl}`;
        }
      }
    } else {
      console.log("validUrl", validUrl);
      // Starts with https://www.. It's a vlaid url, just remove everything after the first '/' after the last occurence of '.'
      // const urlNoSubstack = validUrl.slice(0, validUrl.indexOf("substack.com"));
      // remove https://www.
      const urlWithoutHttpsWWW = validUrl.slice(12, validUrl.length);
      mainComponentInUrl = urlWithoutHttpsWWW.split(".")[0];
      console.log("mainComponentInUrl", mainComponentInUrl);
    }
  } else {
    const urlNoSubstack = validUrl.slice(0, validUrl.indexOf("substack.com"));
    // remove https:// if there is
    const urlWithoutHttps = urlNoSubstack.startsWith("https://")
      ? urlNoSubstack.slice(8, urlNoSubstack.length)
      : urlNoSubstack;
    mainComponentInUrl = urlWithoutHttps.split(".")[0];
  }

  console.log("Done. startingUrl: ", url, "values: ", {
    validUrl,
    mainComponentInUrl,
  });

  // remove everything after the first '/' after the last occurence of '.'
  const lastDotIndex = validUrl.lastIndexOf(".");
  const firstSlashAfterLastDot = validUrl.indexOf("/", lastDotIndex);
  if (firstSlashAfterLastDot !== -1) {
    validUrl = validUrl.slice(0, firstSlashAfterLastDot);
  }

  if (options?.withoutWWW) {
    validUrl = validUrl.replace("www.", "");
  }

  if (validUrl.startsWith("https://")) {
    return { validUrl, mainComponentInUrl };
  } else {
    return { validUrl: `https://${validUrl}`, mainComponentInUrl };
  }
};

export { fetchWithHeaders, delay, scrapeArticles, extractContent };
