import { useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshStandardMaterial, Vector2 } from "three";

export type PassthroughState = {
	center: Vector2;
	resolution: Vector2;
	radius: number;
	softness: number;
	strength: number;
};

type ShaderWithUniforms = {
	uniforms: Record<string, { value: unknown }>;
};

function ensurePassthrough(material: MeshStandardMaterial) {
	if (material.userData.passthroughInitialized) {
		return;
	}
	const previous = material.onBeforeCompile;
	material.transparent = true;
	material.depthWrite = true;
	material.onBeforeCompile = (shader, renderer) => {
		previous(shader, renderer);
		shader.uniforms.uPassCenter = { value: new Vector2(0.5, 0.5) };
		shader.uniforms.uPassResolution = { value: new Vector2(1, 1) };
		shader.uniforms.uPassRadius = { value: 0.14 };
		shader.uniforms.uPassSoftness = { value: 0.08 };
		shader.uniforms.uPassStrength = { value: 0.92 };
		shader.uniforms.uPassEnabled = { value: 0 };
		shader.fragmentShader = shader.fragmentShader.replace(
			"void main() {",
			`
				uniform vec2 uPassCenter;
				uniform vec2 uPassResolution;
				uniform float uPassRadius;
				uniform float uPassSoftness;
				uniform float uPassStrength;
				uniform float uPassEnabled;

				void main() {
			`,
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <dithering_fragment>",
			`
				vec2 passUv = gl_FragCoord.xy / uPassResolution;
				vec2 passDelta = passUv - uPassCenter;
				passDelta.x *= uPassResolution.x / uPassResolution.y;
				float passDist = length(passDelta);
				if (uPassEnabled > 0.5 && passDist < uPassRadius) discard;
				float passMask = 1.0 - smoothstep(uPassRadius, uPassRadius + uPassSoftness, passDist);
				diffuseColor.a *= 1.0 - uPassEnabled * passMask * uPassStrength;
				if (uPassEnabled > 0.5 && diffuseColor.a < 0.02) discard;
				#include <dithering_fragment>
			`,
		);
		material.userData.passthroughShader = shader;
	};
	material.userData.passthroughInitialized = true;
	material.needsUpdate = true;
}

function updatePassthrough(material: MeshStandardMaterial, passthrough: PassthroughState, enabled: boolean) {
	const shader = material.userData.passthroughShader as ShaderWithUniforms | undefined;
	if (!shader) {
		return;
	}
	shader.uniforms.uPassCenter.value = passthrough.center;
	shader.uniforms.uPassResolution.value = passthrough.resolution;
	shader.uniforms.uPassRadius.value = passthrough.radius;
	shader.uniforms.uPassSoftness.value = passthrough.softness;
	shader.uniforms.uPassStrength.value = passthrough.strength;
	shader.uniforms.uPassEnabled.value = enabled ? 1 : 0;
}

export function usePassthroughMaterials(materials: MeshStandardMaterial[], passthrough: PassthroughState | undefined, enabled: boolean) {
	useEffect(() => {
		if (!passthrough) {
			return;
		}
		for (const material of materials) {
			ensurePassthrough(material);
		}
	}, [materials, passthrough]);

	useFrame(() => {
		if (!passthrough) {
			return;
		}
		for (const material of materials) {
			updatePassthrough(material, passthrough, enabled);
		}
	}, 100);
}
