import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import {
	DataTexture,
	Mesh,
	MeshToonMaterial,
	NearestFilter,
	RGBAFormat,
	type Material,
	type Object3D,
} from "three";

export type CelRenderConfig = {
	bandCount: number;
	bandGamma: number;
};

const DEFAULT_CEL_CONFIG: CelRenderConfig = {
	bandCount: 3,
	bandGamma: 1.45,
};

function createGradientMap(bandCount: number, bandGamma: number): DataTexture {
	const clampedBands = Math.max(2, Math.floor(bandCount));
	const gamma = Math.max(0.2, bandGamma);
	const data = new Uint8Array(clampedBands * 4);
	for (let i = 0; i < clampedBands; i++) {
		const t = i / (clampedBands - 1);
		const value = Math.round(Math.pow(t, gamma) * 255);
		const index = i * 4;
		data[index] = value;
		data[index + 1] = value;
		data[index + 2] = value;
		data[index + 3] = 255;
	}
	const texture = new DataTexture(data, clampedBands, 1, RGBAFormat);
	texture.minFilter = NearestFilter;
	texture.magFilter = NearestFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}

function visitToonMaterials(material: Material | Material[], fn: (material: MeshToonMaterial) => void) {
	const isToonMaterial = (value: Material): value is MeshToonMaterial =>
		(value as Material & { isMeshToonMaterial?: boolean }).isMeshToonMaterial === true || value.type === "MeshToonMaterial";

	if (Array.isArray(material)) {
		for (const entry of material) {
			if (isToonMaterial(entry)) {
				fn(entry);
			}
		}
		return;
	}
	if (isToonMaterial(material)) {
		fn(material);
	}
}

function applyToonGradientMap(root: Object3D, gradientMap: DataTexture) {
	root.traverse((object) => {
		if (!(object as Object3D & { isMesh?: boolean }).isMesh) {
			return;
		}
		const mesh = object as Mesh;
		if (!mesh.material) {
			return;
		}
		visitToonMaterials(mesh.material, (material) => {
			if (material.gradientMap !== gradientMap) {
				material.gradientMap = gradientMap;
				material.needsUpdate = true;
			}
		});
	});
}

export function CelRenderLayer({ config = DEFAULT_CEL_CONFIG }: { config?: Partial<CelRenderConfig> }) {
	const { scene } = useThree();
	const mergedConfig = useMemo<CelRenderConfig>(
		() => ({
			...DEFAULT_CEL_CONFIG,
			...config,
		}),
		[config],
	);
	const gradientMap = useMemo(
		() => createGradientMap(mergedConfig.bandCount, mergedConfig.bandGamma),
		[mergedConfig.bandCount, mergedConfig.bandGamma],
	);

	useEffect(() => {
		applyToonGradientMap(scene, gradientMap);
		return () => {
			gradientMap.dispose();
		};
	}, [gradientMap, scene]);

	return null;
}
