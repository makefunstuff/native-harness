// Text helpers.

export function slugify(title: string): string {
	return title.toLowerCase().replaceAll(" ", "-");
}
