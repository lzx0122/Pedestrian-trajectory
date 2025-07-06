import { exp } from "three/tsl";
import { config } from "./config";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
let modelStatuMap = new Map();
const Perlin = {
  perm: new Array(512).fill(0),
  grad: (hash, x) => {
    const h = hash & 15;
    const grad = 1 + (h & 7);
    return (h & 8 ? -grad : grad) * x;
  },
  fade: (t) => t * t * t * (t * (t * 6 - 15) + 10),
  lerp: (a, b, t) => a + t * (b - a),
  noise: function (x) {
    const X = Math.floor(x) & 255;
    x -= Math.floor(x);
    const u = this.fade(x);
    return this.lerp(
      this.grad(this.perm[X], x),
      this.grad(this.perm[X + 1], x - 1),
      u
    );
  },
  init: function () {
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i % 256];
    }
  },
};

export function calcSteps({ startPoint, endPoint, speed, isRandom }) {
  Perlin.init();
  const distancePerStep = config.distancePerStep || 0.1; // 每step走的距離0.1
  const speedMps = (speed * 1000) / 3600; // km/h 轉 m/s

  const dx = endPoint.x - startPoint.x;
  const dz = endPoint.z - startPoint.z;
  const totalDistance = Math.sqrt(dx * dx + dz * dz);
  const stepCount = Math.ceil(totalDistance / distancePerStep);

  const dirX = dx / totalDistance;
  const dirZ = dz / totalDistance;
  const perpX = -dirZ;
  const perpZ = dirX;

  const steps = [];

  for (let i = 0; i <= stepCount; i++) {
    const t = i / stepCount;

    const baseX = startPoint.x + dirX * distancePerStep * i;
    const baseZ = startPoint.z + dirZ * distancePerStep * i;

    let offset = 0;
    let drift = 0;

    if (isRandom) {
      const highFreq = Perlin.noise(t * 30);
      const lowFreq = Perlin.noise(t * 3 + 100);

      offset = (lowFreq - 0.5) * totalDistance * 0.06;
      offset += (highFreq - 0.5) * totalDistance * 0.01;

      drift = (Perlin.noise(t * 10 + 200) - 0.5) * distancePerStep * 0.25;
    }

    const finalX = baseX + perpX * offset + dirX * drift;
    const finalZ = baseZ + perpZ * offset + dirZ * drift;

    const time = (i * distancePerStep) / speedMps;

    steps.push({ x: finalX, z: finalZ, time });
  }

  // 平滑化處理
  const smoothSteps = steps.map((step, i, arr) => {
    if (i === 0 || i === arr.length - 1) return step;
    const prev = arr[i - 1];
    const next = arr[i + 1];
    return {
      x: (prev.x + step.x * 2 + next.x) / 4,
      z: (prev.z + step.z * 2 + next.z) / 4,
      time: step.time,
    };
  });
  //滑化後的座標重新計算時間
  for (let i = 1; i < smoothSteps.length; i++) {
    const prevStep = smoothSteps[i - 1];
    const currentStep = smoothSteps[i];

    const segmentDx = currentStep.x - prevStep.x;
    const segmentDz = currentStep.z - prevStep.z;
    const segmentDistance = Math.sqrt(
      segmentDx * segmentDx + segmentDz * segmentDz
    );

    const timeForSegment = segmentDistance / speedMps;

    currentStep.time = prevStep.time + timeForSegment;
  }

  smoothSteps[0] = { x: startPoint.x, z: startPoint.z, time: 0 };
  const lastStep = smoothSteps[smoothSteps.length - 1];
  smoothSteps[smoothSteps.length - 1] = {
    x: endPoint.x,
    z: endPoint.z,
    time: lastStep.time,
  };

  return smoothSteps;
}

//檢查是否碰撞
export function checkCollision(
  carObj,
  carPosition,
  pedPosition,
  pedSize,
  carAngle = 0
) {
  const semiMajorAxis = carObj.collistionScope.length / 2; // 長半軸 (z)
  const semiMinorAxis = carObj.collistionScope.width / 2; // 短半軸 (x)

  // 1. 計算行人中心到車輛中心的向量
  const dx = pedPosition.x - carPosition.x;
  const dz = pedPosition.z - carPosition.z;

  // 2. 計算這個向量的角度
  const angleToPed = Math.atan2(dx, dz);

  // 3. 計算行相對於車輛旋轉方向的角度差
  // 我們需要將 atan2 的 -PI 到 PI 範圍正規化到 0 到 2PI
  let angleDiff = (angleToPed - carAngle) % (2 * Math.PI);
  if (angleDiff < 0) {
    angleDiff += 2 * Math.PI;
  }

  // 4. 根據這個角度差，使用橢圓的極座標方程式計算在該方向上的橢圓半徑
  const cosAngleDiff = Math.cos(angleDiff);
  const sinAngleDiff = Math.sin(angleDiff);

  const radiusAtAngle =
    (semiMajorAxis * semiMinorAxis) /
    Math.sqrt(
      Math.pow(semiMajorAxis * sinAngleDiff, 2) +
        Math.pow(semiMinorAxis * cosAngleDiff, 2)
    );

  // 5. 計算行人與車輛的實際距離
  const distance = Math.sqrt(dx * dx + dz * dz);

  // 6. 如果實際距離小於或等於在該方向上的橢圓半徑，則發生碰撞
  return distance <= radiusAtAngle;
}

//車子和行人是否碰撞 (使用 OBB)
export function checkPhysicalCollision(
  carPosition,
  carSize,
  carAngle,
  pedPosition,
  pedSize
) {
  const getAxes = (angle, size) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [
      { x: cos, z: sin },
      { x: -sin, z: cos },
    ];
  };

  const getCorners = (position, size, angle) => {
    const halfWidth = size.width / 2;
    const halfLength = size.length / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const x1 = halfWidth * cos;
    const z1 = halfWidth * sin;
    const x2 = halfLength * -sin;
    const z2 = halfLength * cos;

    return [
      { x: position.x + x1 + x2, z: position.z + z1 + z2 },
      { x: position.x - x1 + x2, z: position.z - z1 + z2 },
      { x: position.x - x1 - x2, z: position.z - z1 - z2 },
      { x: position.x + x1 - x2, z: position.z + z1 - z2 },
    ];
  };

  const project = (corners, axis) => {
    let min = Infinity,
      max = -Infinity;
    for (const corner of corners) {
      const dot = corner.x * axis.x + corner.z * axis.z;
      min = Math.min(min, dot);
      max = Math.max(max, dot);
    }
    return { min, max };
  };

  const carCorners = getCorners(carPosition, carSize, carAngle);
  const pedCorners = getCorners(pedPosition, pedSize, 0); // 行人通常不旋轉

  const axes = [
    ...getAxes(carAngle, carSize),
    ...getAxes(0, pedSize), // 行人軸
  ];

  for (const axis of axes) {
    const p1 = project(carCorners, axis);
    const p2 = project(pedCorners, axis);
    if (p1.max < p2.min || p2.max < p1.min) {
      return false; // 找到分離軸，沒有碰撞
    }
  }

  return true; // 沒有找到分離軸，發生碰撞
}

// 發出警示
export function shouldWarn(timeToCollision, carSpeedKmh) {
  const v_mps = (carSpeedKmh.speed * 1000) / 3600;
  console.log(config.params.t_reaction + v_mps / config.params.a_brake);
  const warningThreshold =
    config.params.t_reaction + v_mps / config.params.a_brake; // t_reaction + v / a_brake
  return timeToCollision <= warningThreshold;
}

function disabledButton() {
  document.querySelector("#start").disabled = true;
  document.querySelector("#restart").disabled = true;
}

function enabledButton() {
  document.querySelector("#start").disabled = false;
  document.querySelector("#restart").disabled = false;
}

export function loadModelOBJ(fileName) {
  let loading_items = document.querySelector("#loading-items");
  let itemId = "loading-" + fileName;
  disabledButton();
  modelStatuMap.set(fileName, false);

  let itemHTML = `<div
        id="${itemId}"
        class="d-flex justify-content-between align-items-center bg-secondary bg-opacity-50 p-2 rounded mb-2"
      >
        <span class="small fw-medium text-truncate me-2">${fileName}</span>
        <div class="indicator-circle rounded-circle bg-warning" style="width: 16px; height: 16px;"></div>
      </div>`;

  // 插入到 DOM 中
  loading_items.insertAdjacentHTML("beforeend", itemHTML);

  return new Promise((resolve, reject) => {
    const mtlLoader = new MTLLoader();
    mtlLoader.load(
      "/assets/" + fileName + ".mtl",
      (materials) => {
        materials.preload();
        const objLoader = new OBJLoader();
        objLoader.setMaterials(materials);
        objLoader.load(
          "/assets/" + fileName + ".obj",
          (object) => {
            let loadingItem = document.getElementById(itemId);
            if (loadingItem) {
              let indicator = loadingItem.querySelector(".indicator-circle");
              if (indicator) {
                indicator.classList.remove("bg-warning");
                indicator.classList.add("bg-success");
              }
            }
            modelStatuMap.set(fileName, true);

            resolve(object);

            let isAllLoading = true;

            for (let [k, v] of modelStatuMap) {
              if (!v) {
                isAllLoading = false;
                break;
              }
            }

            if (isAllLoading) {
              enabledButton();
            }
          },
          null,
          (error) => {
            let loadingItem = document.getElementById(itemId);
            if (loadingItem) {
              let indicator = loadingItem.querySelector(".indicator-circle");
              if (indicator) {
                indicator.classList.remove("bg-warning");
                indicator.classList.add("bg-danger");
              }
            }
            console.error(error);
            reject(error);
          }
        );
      },
      null,
      (error) => {
        reject(error);
      }
    );
  });
}

export function interpolateSteps({ steps, distancePerStep }) {
  if (!steps || steps.length < 2) {
    return steps;
  }

  const newSteps = [steps[0]]; // 從第一個點開始

  for (let i = 1; i < steps.length; i++) {
    const startPoint = steps[i - 1];
    const endPoint = steps[i];

    const dx = endPoint.x - startPoint.x;
    const dz = endPoint.z - startPoint.z;
    const segmentDistance = Math.sqrt(dx * dx + dz * dz);

    if (segmentDistance === 0) continue; // 如果點重合，則跳過

    const numSubSteps = Math.ceil(segmentDistance / distancePerStep);

    for (let j = 1; j <= numSubSteps; j++) {
      const t = j / numSubSteps;
      const newX = startPoint.x + dx * t;
      const newZ = startPoint.z + dz * t;
      newSteps.push({ x: newX, z: newZ });
    }
  }
  return newSteps;
}

export function calculateTimeForSteps({ steps, speed }) {
  if (!steps || steps.length === 0) {
    return [];
  }

  const speedMps = (speed * 1000) / 3600; // km/h 轉 m/s
  const timedSteps = steps.map((step) => ({ ...step })); // 創建副本以避免修改原始數據

  timedSteps[0].time = 0;

  for (let i = 1; i < timedSteps.length; i++) {
    const prevStep = timedSteps[i - 1];
    const currentStep = timedSteps[i];

    const segmentDx = currentStep.x - prevStep.x;
    const segmentDz = currentStep.z - prevStep.z;
    const segmentDistance = Math.sqrt(
      segmentDx * segmentDx + segmentDz * segmentDz
    );

    const timeForSegment = segmentDistance / speedMps;
    currentStep.time = prevStep.time + timeForSegment;
  }

  return timedSteps;
}

export function loadModelFBX(fileName) {
  let loading_items = document.querySelector("#loading-items");
  let itemId = "loading-" + fileName;
  disabledButton();
  modelStatuMap.set(fileName, false);

  let itemHTML = `<div
        id="${itemId}"
        class="d-flex justify-content-between align-items-center bg-secondary bg-opacity-50 p-2 rounded mb-2"
      >
        <span class="small fw-medium text-truncate me-2">${fileName}</span>
        <div class="indicator-circle rounded-circle bg-warning" style="width: 16px; height: 16px;"></div>
      </div>`;

  // 插入到 DOM 中
  loading_items.insertAdjacentHTML("beforeend", itemHTML);

  return new Promise((resolve, reject) => {
    const fbxLoader = new FBXLoader();
    fbxLoader.load(
      "/assets/" + fileName + ".fbx",
      (object) => {
        let loadingItem = document.getElementById(itemId);
        if (loadingItem) {
          let indicator = loadingItem.querySelector(".indicator-circle");
          if (indicator) {
            indicator.classList.remove("bg-warning");
            indicator.classList.add("bg-success");
          }
        }
        modelStatuMap.set(fileName, true);

        resolve(object);

        let isAllLoading = true;
        for (let [k, v] of modelStatuMap) {
          if (!v) {
            isAllLoading = false;
            break;
          }
        }

        if (isAllLoading) {
          enabledButton();
        }
      },
      null,
      (error) => {
        let loadingItem = document.getElementById(itemId);
        if (loadingItem) {
          let indicator = loadingItem.querySelector(".indicator-circle");
          if (indicator) {
            indicator.classList.remove("bg-warning");
            indicator.classList.add("bg-danger");
          }
        }
        console.error(error);
        reject(error);
      }
    );
  });
}
