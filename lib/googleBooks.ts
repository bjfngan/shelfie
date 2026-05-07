export interface BookMetadata {
  id: string;
  title: string;
  author: string;
  rating: number | null;
  ratingsCount: number | null;
  thumbnail: string | null;
  goodreadsUrl: string;
}

export async function searchBooks(query: string): Promise<BookMetadata[]> {
  const encoded = encodeURIComponent(query);
  const key = process.env.GOOGLE_BOOKS_API_KEY
    ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}`
    : "";
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encoded}&maxResults=5&printType=books${key}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Books API error: ${res.status} — ${body}`);
  }

  const data = await res.json();
  if (!data.items || data.items.length === 0) return [];

  return data.items.map(normalizeVolume);
}

export async function getBookById(id: string): Promise<BookMetadata | null> {
  const key = process.env.GOOGLE_BOOKS_API_KEY
    ? `?key=${process.env.GOOGLE_BOOKS_API_KEY}`
    : "";
  const url = `https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(id)}${key}`;

  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Books API error: ${res.status} — ${body}`);
  }

  return normalizeVolume(await res.json());
}

function normalizeVolume(item: any): BookMetadata {
  const info = item.volumeInfo ?? {};
  const title: string = info.title ?? "Unknown Title";
  const author: string = (info.authors ?? ["Unknown Author"])[0];
  const thumbnail: string | null =
    info.imageLinks?.smallThumbnail?.replace("http://", "https://") ?? null;
  const isbn = extractIsbn(info.industryIdentifiers);

  return {
    id: item.id,
    title,
    author,
    rating: info.averageRating ?? null,
    ratingsCount: info.ratingsCount ?? null,
    thumbnail,
    goodreadsUrl: buildGoodreadsUrl(title, author, isbn),
  };
}

function extractIsbn(
  identifiers: Array<{ type: string; identifier: string }> | undefined
): string | null {
  if (!identifiers) return null;
  const isbn13 = identifiers.find((i) => i.type === "ISBN_13");
  if (isbn13) return isbn13.identifier;
  const isbn10 = identifiers.find((i) => i.type === "ISBN_10");
  return isbn10?.identifier ?? null;
}

// With an ISBN, goodreads.com/book/isbn/{isbn} redirects to the actual book page.
// Without one, fall back to the search URL.
function buildGoodreadsUrl(
  title: string,
  author: string,
  isbn: string | null
): string {
  if (isbn) return `https://www.goodreads.com/book/isbn/${isbn}`;
  const query = encodeURIComponent(`${title} ${author}`);
  return `https://www.goodreads.com/search?q=${query}`;
}
