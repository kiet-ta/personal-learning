import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

export type Graph3DPoint = {
  x: number;
  y: number;
  z: number;
};

export type Graph3DNodeTone = "blue" | "green" | "amber" | "pink" | "gray" | "source" | "hub" | "vault" | "focus";

export type Graph3DNodeSize = "pin" | "sm" | "md" | "lg" | "hub" | "vault" | "focus";

export type Graph3DLabelMode = "anchor" | "peek" | "hidden";

export type KnowledgeGraph3DNode = {
  id: string;
  title: string;
  subtitle?: string;
  point: Graph3DPoint;
  tone: Graph3DNodeTone;
  size: Graph3DNodeSize;
  labelMode: Graph3DLabelMode;
};

export type KnowledgeGraph3DEdge = {
  id: string;
  from: Graph3DPoint;
  to: Graph3DPoint;
  tone: "constellation" | "vault" | "focus";
};

type KnowledgeGraph3DProps = {
  nodes: KnowledgeGraph3DNode[];
  edges: KnowledgeGraph3DEdge[];
};

const nodeToneColors: Record<Graph3DNodeTone, string> = {
  blue: "#5468b3",
  green: "#86a13f",
  amber: "#aa7b3f",
  pink: "#b3528f",
  gray: "#8a8d87",
  source: "#9fb36f",
  hub: "#b7b8b2",
  vault: "#aeb1aa",
  focus: "#2f78a8"
};

const nodeRadii: Record<Graph3DNodeSize, number> = {
  pin: 0.072,
  sm: 0.094,
  md: 0.12,
  lg: 0.15,
  hub: 0.19,
  vault: 0.18,
  focus: 0.18
};

const tiltBoostBySize: Record<Graph3DNodeSize, number> = {
  pin: 0.92,
  sm: 0.68,
  md: 0.4,
  lg: 0.24,
  hub: 0.06,
  vault: 0.08,
  focus: 0.1
};

const edgeToneColors: Record<KnowledgeGraph3DEdge["tone"], string> = {
  constellation: "#7c8078",
  vault: "#78856f",
  focus: "#2f78a8"
};

const edgeToneOpacity: Record<KnowledgeGraph3DEdge["tone"], number> = {
  constellation: 0.2,
  vault: 0.26,
  focus: 0.58
};

export function KnowledgeGraph3D({ nodes, edges }: KnowledgeGraph3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  const hoverLabelRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const anchorNodes = useMemo(() => nodes.filter((node) => node.labelMode === "anchor"), [nodes]);
  const hoveredNode = hoveredId ? nodes.find((node) => node.id === hoveredId) ?? null : null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || nodes.length === 0) {
      return;
    }
    const hostElement = host;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance"
    });
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(-10, -10);
    const positionScratch = new THREE.Vector3();
    const projectionScratch = new THREE.Vector3();
    const matrixScratch = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scaleScratch = new THREE.Vector3();
    const hoveredIndexRef = { current: -1 };
    const tiltRef = { currentX: -0.04, currentY: 0, targetX: -0.04, targetY: 0 };
    const dragRef = { active: false, lastX: 0, lastY: 0 };
    const hasManualTiltRef = { current: false };
    const maxTilt = Math.PI / 4;
    let width = 1;
    let height = 1;
    let animationFrame = 0;

    renderer.setClearColor(0xffffff, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    hostElement.appendChild(renderer.domElement);

    camera.position.set(0, -0.65, 13.8);
    camera.lookAt(0, 0, 0);

    const graphGroup = new THREE.Group();
    graphGroup.rotation.x = tiltRef.currentX;
    graphGroup.rotation.y = tiltRef.currentY;
    scene.add(graphGroup);

    scene.add(new THREE.AmbientLight(0xffffff, 0.78));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.18);
    keyLight.position.set(3.4, 6.2, 8);
    scene.add(keyLight);

    const depthLight = new THREE.PointLight(0x9fb36f, 0.62, 18);
    depthLight.position.set(-4, -3, 4);
    scene.add(depthLight);

    const floorGrid = new THREE.GridHelper(14, 24, 0xd6d2c8, 0xe9e6df);
    floorGrid.position.set(0, -4.85, -1.8);
    floorGrid.rotation.x = Math.PI * 0.03;
    const floorGridMaterial = floorGrid.material as THREE.Material;
    floorGridMaterial.transparent = true;
    floorGridMaterial.opacity = 0.22;
    graphGroup.add(floorGrid);

    const nodePositions = nodes.map((node) => toScenePoint(node.point));
    const nodeBaseRadii = nodes.map((node) => nodeRadii[node.size]);
    const pickRadii = nodeBaseRadii.map((radius) => Math.max(radius * 2.25, 0.16));
    const nodeGeometry = new THREE.SphereGeometry(1, 24, 16);
    const nodeMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.58,
      metalness: 0.04,
      vertexColors: true
    });
    const nodeMesh = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, nodes.length);
    nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    graphGroup.add(nodeMesh);

    const pickGeometry = new THREE.SphereGeometry(1, 10, 8);
    const pickMaterial = new THREE.MeshBasicMaterial({
      depthWrite: false,
      opacity: 0,
      transparent: true
    });
    const pickMesh = new THREE.InstancedMesh(pickGeometry, pickMaterial, nodes.length);
    pickMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    graphGroup.add(pickMesh);

    nodes.forEach((node, index) => {
      writeNodeInstance(nodeMesh, nodes, nodePositions, nodeBaseRadii, index, index === hoveredIndexRef.current, 0, matrixScratch, quaternion, scaleScratch);
      writeNodeInstance(pickMesh, nodes, nodePositions, pickRadii, index, false, 0, matrixScratch, quaternion, scaleScratch);
      nodeMesh.setColorAt(index, new THREE.Color(nodeToneColors[node.tone]));
    });
    if (nodeMesh.instanceColor) {
      nodeMesh.instanceColor.needsUpdate = true;
    }
    nodeMesh.instanceMatrix.needsUpdate = true;

    const edgeObjects = buildEdgeObjects(edges);
    edgeObjects.forEach((edgeObject) => graphGroup.add(edgeObject));

    function resize() {
      const bounds = hostElement.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      const compactGraph = width < 620 || width / height < 0.82;
      camera.fov = compactGraph ? 50 : 42;
      camera.position.z = compactGraph ? 16.4 : 13.8;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    }

    function projectLabel(point: THREE.Vector3, element: HTMLElement, active: boolean, depthOpacity = 1) {
      projectionScratch.copy(point).project(camera);
      const onScreen =
        projectionScratch.z < 1 &&
        projectionScratch.x > -1.2 &&
        projectionScratch.x < 1.2 &&
        projectionScratch.y > -1.2 &&
        projectionScratch.y < 1.2;
      const x = (projectionScratch.x * 0.5 + 0.5) * width;
      const y = (-projectionScratch.y * 0.5 + 0.5) * height;
      element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -118%)`;
      element.style.opacity = onScreen ? String(active ? depthOpacity : Math.min(0.78, depthOpacity)) : "0";
    }

    function syncLabels() {
      graphGroup.updateMatrixWorld();
      for (const node of anchorNodes) {
        const element = labelRefs.current.get(node.id);
        if (!element) {
          continue;
        }
        const index = nodes.findIndex((candidate) => candidate.id === node.id);
        if (index < 0) {
          continue;
        }
        const depthOpacity = Math.max(0.42, Math.min(1, 0.78 + nodePositions[index].z * 0.06));
        positionScratch.copy(nodePositions[index]).applyMatrix4(graphGroup.matrixWorld);
        projectLabel(positionScratch, element, true, depthOpacity);
      }

      const hoverElement = hoverLabelRef.current;
      const hoveredIndex = hoveredIndexRef.current;
      if (hoverElement && hoveredIndex >= 0) {
        positionScratch.copy(nodePositions[hoveredIndex]);
        positionScratch.y += nodeBaseRadii[hoveredIndex] * 1.9;
        positionScratch.applyMatrix4(graphGroup.matrixWorld);
        projectLabel(positionScratch, hoverElement, true, 1);
      } else if (hoverElement) {
        hoverElement.style.opacity = "0";
      }
    }

    function writeAllNodeInstances(tiltProgress: number) {
      for (let index = 0; index < nodes.length; index += 1) {
        writeNodeInstance(
          nodeMesh,
          nodes,
          nodePositions,
          nodeBaseRadii,
          index,
          index === hoveredIndexRef.current,
          tiltProgress,
          matrixScratch,
          quaternion,
          scaleScratch
        );
        writeNodeInstance(pickMesh, nodes, nodePositions, pickRadii, index, false, tiltProgress * 0.35, matrixScratch, quaternion, scaleScratch);
      }
      nodeMesh.instanceMatrix.needsUpdate = true;
      pickMesh.instanceMatrix.needsUpdate = true;
    }

    function setHoveredIndex(nextIndex: number) {
      const previousIndex = hoveredIndexRef.current;
      if (previousIndex === nextIndex) {
        return;
      }

      hoveredIndexRef.current = nextIndex;
      writeAllNodeInstances(tiltProgress(tiltRef.currentX, tiltRef.currentY, maxTilt));
      hostElement.classList.toggle("is-hovering", nextIndex >= 0);
      setHoveredId(nextIndex >= 0 ? nodes[nextIndex].id : null);
    }

    function handlePointerMove(event: PointerEvent) {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const [hit] = raycaster.intersectObject(pickMesh, false);
      setHoveredIndex(typeof hit?.instanceId === "number" ? hit.instanceId : -1);

      if (dragRef.active) {
        const dx = event.clientX - dragRef.lastX;
        const dy = event.clientY - dragRef.lastY;
        dragRef.lastX = event.clientX;
        dragRef.lastY = event.clientY;
        tiltRef.targetY = clamp(tiltRef.targetY + dx * 0.006, -maxTilt, maxTilt);
        tiltRef.targetX = clamp(tiltRef.targetX + dy * 0.0045, -maxTilt * 0.55, maxTilt * 0.55);
      }
    }

    function handlePointerDown(event: PointerEvent) {
      dragRef.active = true;
      hasManualTiltRef.current = true;
      dragRef.lastX = event.clientX;
      dragRef.lastY = event.clientY;
      hostElement.classList.add("is-dragging");
      renderer.domElement.setPointerCapture(event.pointerId);
    }

    function handlePointerUp(event: PointerEvent) {
      dragRef.active = false;
      hostElement.classList.remove("is-dragging");
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    }

    function handlePointerLeave() {
      dragRef.active = false;
      hostElement.classList.remove("is-dragging");
      setHoveredIndex(-1);
    }

    function animate() {
      if (!reduceMotion && !hasManualTiltRef.current && !dragRef.active && hoveredIndexRef.current < 0) {
        const elapsed = performance.now() * 0.00018;
        tiltRef.targetY = Math.sin(elapsed) * 0.08;
        tiltRef.targetX = -0.04 + Math.cos(elapsed * 0.8) * 0.035;
      }

      const damping = reduceMotion ? 1 : 0.12;
      tiltRef.currentX += (tiltRef.targetX - tiltRef.currentX) * damping;
      tiltRef.currentY += (tiltRef.targetY - tiltRef.currentY) * damping;
      graphGroup.rotation.x = tiltRef.currentX;
      graphGroup.rotation.y = tiltRef.currentY;
      hostElement.dataset.tilt = `${tiltRef.currentX.toFixed(3)},${tiltRef.currentY.toFixed(3)}`;
      writeAllNodeInstances(tiltProgress(tiltRef.currentX, tiltRef.currentY, maxTilt));
      syncLabels();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(hostElement);
    resize();
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerUp);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      nodeGeometry.dispose();
      nodeMaterial.dispose();
      pickGeometry.dispose();
      pickMaterial.dispose();
      edgeObjects.forEach((edgeObject) => {
        edgeObject.geometry.dispose();
        const material = edgeObject.material;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material.dispose();
        }
      });
      floorGrid.geometry.dispose();
      floorGridMaterial.dispose();
      renderer.dispose();
      hostElement.replaceChildren();
    };
  }, [anchorNodes, edges, nodes]);

  return (
    <div className="knowledge-graph-3d" aria-label="Knowledge graph 3D preview">
      <div className="graph3d-canvas-host" ref={hostRef} />
      <div className="graph3d-label-layer" aria-hidden="true">
        {anchorNodes.map((node) => (
          <div
            className={`graph3d-label ${node.tone}`}
            key={node.id}
            ref={(element) => {
              if (element) {
                labelRefs.current.set(node.id, element);
              } else {
                labelRefs.current.delete(node.id);
              }
            }}
          >
            <strong>{node.title}</strong>
            {node.subtitle ? <small>{node.subtitle}</small> : null}
          </div>
        ))}
        <div className={`graph3d-hover-label ${hoveredNode ? "active" : ""}`} ref={hoverLabelRef}>
          {hoveredNode ? (
            <>
              <strong>{hoveredNode.title}</strong>
              {hoveredNode.subtitle ? <small>{hoveredNode.subtitle}</small> : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function buildEdgeObjects(edges: KnowledgeGraph3DEdge[]) {
  const edgesByTone = new Map<KnowledgeGraph3DEdge["tone"], KnowledgeGraph3DEdge[]>();
  for (const edge of edges) {
    edgesByTone.set(edge.tone, [...(edgesByTone.get(edge.tone) ?? []), edge]);
  }

  return Array.from(edgesByTone, ([tone, toneEdges]) => {
    const positions = new Float32Array(toneEdges.length * 6);
    toneEdges.forEach((edge, index) => {
      const from = toScenePoint(edge.from);
      const to = toScenePoint(edge.to);
      positions.set([from.x, from.y, from.z, to.x, to.y, to.z], index * 6);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: edgeToneColors[tone],
      depthWrite: false,
      opacity: edgeToneOpacity[tone],
      transparent: true
    });

    return new THREE.LineSegments(geometry, material);
  });
}

function writeNodeInstance(
  mesh: THREE.InstancedMesh,
  nodes: KnowledgeGraph3DNode[],
  positions: THREE.Vector3[],
  radii: number[],
  index: number,
  hovered: boolean,
  tiltProgress: number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  scale: THREE.Vector3
) {
  const hoverScale = hovered ? 1.72 : 1;
  const tiltScale = 1 + tiltBoostBySize[nodes[index].size] * tiltProgress;
  scale.setScalar(radii[index] * hoverScale * tiltScale);
  matrix.compose(positions[index], quaternion, scale);
  mesh.setMatrixAt(index, matrix);
}

function toScenePoint(point: Graph3DPoint) {
  return new THREE.Vector3((point.x - 50) / 9.2, (50 - point.y) / 9.2, point.z / 62);
}

function tiltProgress(x: number, y: number, maxTilt: number) {
  return Math.min(1, (Math.abs(x) + Math.abs(y)) / (maxTilt * 1.35));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
