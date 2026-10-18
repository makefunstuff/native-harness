// Text helpers.

export function slugify(title: string): string {
	const slug = title
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!slug) throw new RangeError(`empty slug for ${JSON.stringify(title)}`);
	return slug;
}
