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

  return data.items.map((item: any): BookMetadata => {
    const info = item.volumeInfo ?? {};
    const title: string = info.title ?? "Unknown Title";
    const author: string = (info.authors ?? ["Unknown Author"])[0];
    const thumbnail: string | null =
      info.imageLinks?.smallThumbnail?.replace("http://", "https://") ?? null;

    return {
      id: item.id,
      title,
      author,
      rating: info.averageRating ?? null,
      ratingsCount: info.ratingsCount ?? null,
      thumbnail,
      goodreadsUrl: buildGoodreadsUrl(title, author),
    };
  });
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

  const item = await res.json();
  const info = item.volumeInfo ?? {};
  const title: string = info.title ?? "Unknown Title";
  const author: string = (info.authors ?? ["Unknown Author"])[0];
  const thumbnail: string | null =
    info.imageLinks?.smallThumbnail?.replace("http://", "https://") ?? null;

  return {
    id: item.id,
    title,
    author,
    rating: info.averageRating ?? null,
    ratingsCount: info.ratingsCount ?? null,
    thumbnail,
    goodreadsUrl: buildGoodreadsUrl(title, author),
  };
}

function buildGoodreadsUrl(title: string, author: string): string {
  const query = encodeURIComponent(`${title} ${author}`);
  return `https://www.goodreads.com/search?q=${query}`;
}
