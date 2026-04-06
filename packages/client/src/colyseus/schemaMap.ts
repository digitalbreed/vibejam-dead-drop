export function schemaMapValues<T>(value: unknown): T[] {
	if (!value) {
		return [];
	}
	if (typeof value === "object" && value !== null && "values" in value && typeof (value as { values: () => Iterable<T> }).values === "function") {
		return Array.from((value as { values: () => Iterable<T> }).values());
	}
	return Object.values(value as Record<string, T>);
}
