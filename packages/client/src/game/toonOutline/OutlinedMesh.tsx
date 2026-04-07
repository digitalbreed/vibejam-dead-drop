import { useMemo } from "react";
import type { ThreeElements } from "@react-three/fiber";
import type { Material } from "three";
import { createBackfaceOutlineMaterial } from "./outlineMaterial";

export function OutlinedMesh({
	geometryNode,
	materialNode,
	outlineThickness = 0.028,
	outlineColor = "#000000",
	outlined = true,
	...meshProps
}: ThreeElements["mesh"] & {
	geometryNode: React.ReactNode;
	materialNode: React.ReactNode;
	outlineThickness?: number;
	outlineColor?: string;
	outlined?: boolean;
}) {
	const outlineMaterial: Material = useMemo(
		() => createBackfaceOutlineMaterial({ color: outlineColor, thickness: outlineThickness }),
		[outlineColor, outlineThickness],
	);

	return (
		<group>
			{outlined ? (
				<mesh {...meshProps} material={outlineMaterial}>
					{geometryNode}
				</mesh>
			) : null}
			<mesh {...meshProps}>
				{geometryNode}
				{materialNode}
			</mesh>
		</group>
	);
}

