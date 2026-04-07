import { BackSide, Color, MeshBasicMaterial } from "three";

/**
 * Backface outline material: expands vertices along normals in the vertex shader.
 * This avoids object-scale hacks that would skew world-space merged geometry.
 */
const OUTLINE_MATERIAL_CACHE = new Map<string, MeshBasicMaterial>();

export function createBackfaceOutlineMaterial({
	color = "#000000",
	thickness = 0.03,
}: {
	color?: string | number | Color;
	/** World-ish thickness in object space (keep small). */
	thickness?: number;
}) {
	const colorObj = color instanceof Color ? color : new Color(color as any);
	const cacheKey = `${colorObj.getHexString()}:${thickness}`;
	const cached = OUTLINE_MATERIAL_CACHE.get(cacheKey);
	if (cached) {
		return cached;
	}

	const material = new MeshBasicMaterial({
		color: colorObj,
		side: BackSide,
		depthTest: true,
		depthWrite: true,
	});

	// Ensure the shader isn't shared across thickness values.
	(material as any).customProgramCacheKey = () => `backface-outline-v1:${String(thickness)}`;

	material.onBeforeCompile = (shader) => {
		shader.uniforms.outlineThickness = { value: thickness };
		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				"#include <common>\nuniform float outlineThickness;",
			)
			.replace(
				"#include <begin_vertex>",
				"#include <begin_vertex>\ntransformed += normal * outlineThickness;",
			);
	};

	OUTLINE_MATERIAL_CACHE.set(cacheKey, material);
	return material;
}

