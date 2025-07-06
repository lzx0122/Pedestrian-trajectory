import * as THREE from "three";
import "bootstrap/dist/css/bootstrap.min.css";
import { obj } from "./obj.js";
import { config } from "./config.js";
import {
  checkPhysicalCollision,
  checkCollision,
  shouldWarn,
  loadModelOBJ,
  loadModelFBX,
  calculateTimeForSteps,
  interpolateSteps,
} from "./PTlib.js";

import { speed_ui, updateSpeed } from "./components/speed_ui.js";

// 緩存 DOM 元素
const textElement = document.querySelector("#text");
const warningElement = document.getElementById("warning");
const speedElement = document.getElementById("speed");
const secElement = document.querySelector("#sec");
const brakeIndicator = document.createElement("div");

// --- 狀態變數 ---
let audio = null;
let makerTemps = [];
let elapsedTime = 0;
let isPlaying = false;
let isPlayCollision = false;
let animateId = null;
let startTime = null;
let isBrakingActive = false;
let originalCarSteps = [];

// --- 場景物件變數 ---
let carModel; // 3D 模型
let carBodyPlaceholder; // 模型下方的實體方塊
let carEllipse; // 橢圓警示區
let pedsPlayObjects = [];
let pedsPlayModels = [];

let startX_panel = 50;
let startZ_panel = 0;
let endX_panel = -5;
let endZ_panel = -2;

// 初始化場景
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  100,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const light = new THREE.HemisphereLight(0xffffff, 0x444444);
scene.add(light);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
scene.add(directionalLight);

function init() {
  document.getElementById("startX_panel").value = startX_panel;
  document.getElementById("startZ_panel").value = startZ_panel;
  document.getElementById("endX_panel").value = endX_panel;
  document.getElementById("endZ_panel").value = endZ_panel;
  speedElement.value = 60;

  brakeIndicator.id = "brakeIndicator";
  brakeIndicator.style.cssText =
    "position: fixed; top: 10px; right: 10px; background: red; width: 20px; height: 20px; border-radius: 50%; display: none;";
  document.body.appendChild(brakeIndicator);
}

document.addEventListener("DOMContentLoaded", () => {
  init();
  renderer.render(scene, camera);
});

function createFloorTiles() {
  const boxGeo = new THREE.BoxGeometry(100, 0.01, 100);
  const boxMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const tile = new THREE.Mesh(boxGeo, boxMat);
  tile.position.set(0, 0, 0);
  scene.add(tile);
}
createFloorTiles();

let carSpeed = parseInt(speedElement.value);
speed_ui(carSpeed);

let ped1 = new obj({
  name: "行人1",
  color: 0x013220,
  speed: 60,
  steps: calculateTimeForSteps({
    steps: interpolateSteps({
      steps: config.pedSteps,
      distancePerStep: config.distancePerStep,
    }),
    speed: 3,
  }),
  entitySize: { length: 0.5, width: 0.5 },
  modelFun: null,
});

let car = new obj({
  name: "car",
  color: 0x007bff,
  speed: carSpeed,
  startPoint: { x: 0, z: -50 },
  endPoint: { x: -2, z: 30 },
  entitySize: { length: 4.63, width: config.params.w_car },
  modelFun: null,
});

let peds = [ped1];

let cameraMode = "FPP";
setFPP();

function setFPP() {
  camera.lookAt(car.endPoint.x, 2, car.endPoint.z);
  camera.rotation.set(0, 0, 0);
  camera.position.set(car.startPoint.x, 2, car.startPoint.z);
  camera.rotateY(-Math.PI / 2);
  camera.rotateX(-20 * (Math.PI / 180));
}

function setTPP() {
  camera.rotation.set(0, 0, 0);
  camera.position.set(5, 50, 0);
  camera.rotateY(-Math.PI / 2);
  camera.rotateX(-90 * (Math.PI / 180));
}

function drawLine(point1, point2, color = 0x178bfd, riskFactor = 0) {
  let extension = 0;
  const distance = new THREE.Vector2(point1.x, point1.z).distanceTo(
    new THREE.Vector2(point2.x, point2.z)
  );
  const direction = new THREE.Vector2(
    point2.x - point1.x,
    point2.z - point1.z
  ).normalize();
  const extendedPoint1 = new THREE.Vector3(
    point1.x - direction.x * extension,
    point1.y,
    point1.z - direction.y * extension
  );
  const extendedPoint2 = new THREE.Vector3(
    point2.x + direction.x * extension,
    point2.y,
    point2.z + direction.y * extension
  );
  const extendedDistance = distance + extension * 2;
  const geometry = new THREE.PlaneGeometry(0.2, extendedDistance);
  const material = new THREE.MeshBasicMaterial({
    color: riskFactor > 0.5 ? 0xff0000 : color,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });
  const route = new THREE.Mesh(geometry, material);
  const center = new THREE.Vector3(
    (extendedPoint1.x + extendedPoint2.x) / 2,
    0.03,
    (extendedPoint1.z + extendedPoint2.z) / 2
  );
  route.position.copy(center);
  const angle = Math.atan2(point2.x - point1.x, point2.z - point1.z);
  route.rotation.x = -Math.PI / 2;
  route.rotation.z = angle;
  point2.line = route;
  scene.add(route);
  makerTemps.push(route);
  return route;
}
function showTrajectory(obj, step, color = 0x00ff00, riskFactor = 0) {
  let useColor = step < 3 ? 0xfd481b : riskFactor > 0.5 ? 0xff0000 : color;
  if (step > 0)
    drawLine(obj.steps[step - 1], obj.steps[step], useColor, riskFactor);
  const point = obj.steps[step];
  const marker = new THREE.Object3D();
  marker.position.set(point.x, -0.1, point.z);
  marker.obj = obj;
  scene.add(marker);
  makerTemps.push(marker);
  return marker;
}

//設置預測時間點
function setTrajectoryMaps(tempPoints, maker, step) {
  const timeKey = maker.obj.steps[step].time.toFixed(3);

  if (maker.obj.name === "car") {
    tempPoints.set(timeKey, {
      carObj: {
        maker,
        // collistionScope is already on maker.obj, no need to duplicate
      },
      pedObjs: [],
    });
  } else {
    const timeTolerance = 0.01;
    for (let [carTimeKey, carPoint] of tempPoints) {
      const carTime = parseFloat(carTimeKey);
      const pedTime = parseFloat(timeKey);

      if (Math.abs(carTime - pedTime) <= timeTolerance) {
        const carMkr = carPoint.carObj.maker;
        const pedMkr = maker;

        const carStepIndex = car.steps.findIndex((s) => s.maker === carMkr);
        const nextCarStep =
          car.steps[carStepIndex + 1] || car.steps[carStepIndex];

        let carAngle = 0;
        if (nextCarStep && carMkr) {
          const dx = nextCarStep.x - carMkr.position.x;
          const dz = nextCarStep.z - carMkr.position.z;
          if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
            carAngle = Math.atan2(dx, dz); // 修正：使用正確的參數順序
          }
        }

        // 執行橢圓警示區檢查
        const isInWarningZone = checkCollision(
          carMkr.obj,
          carMkr.position,
          pedMkr.position,
          pedMkr.obj.entitySize,
          carAngle
        );

        // 執行物理實體碰撞檢查
        const isPhysicalHit = checkPhysicalCollision(
          carMkr.position,
          carMkr.obj.entitySize,
          carAngle,
          pedMkr.position,
          pedMkr.obj.entitySize
        );

        // 如果任一條件成立，就記錄下來
        if (isInWarningZone || isPhysicalHit) {
          const collisionData = { maker: pedMkr };
          if (isInWarningZone) {
            collisionData.collisionTime = carTime;
          }
          if (isPhysicalHit) {
            collisionData.physicalCollisionTime = carTime;
          }
          carPoint.pedObjs.push(collisionData);
        }
      }
    }
  }
}

function simulateBrakingSteps(car, step, reactionTime_s, brakeAccel_mps2) {
  const carStep = car.steps[step];
  const initialSpeed_mps = (car.speed * 1000) / 3600;
  const distancePerStep = config.distancePerStep;
  const nextOriginalStep = car.steps[step + 1] || carStep;
  const dx = nextOriginalStep.x - carStep.x;
  const dz = nextOriginalStep.z - carStep.z;
  const direction = new THREE.Vector2(dx, dz).normalize();
  let lastStep = carStep;
  const newBrakingSteps = [];
  const reactionDistance = initialSpeed_mps * reactionTime_s;
  const numReactionSteps = Math.ceil(reactionDistance / distancePerStep);
  const timePerReactionStep =
    numReactionSteps > 0 ? reactionTime_s / numReactionSteps : 0;
  for (let i = 0; i < numReactionSteps; i++) {
    const newPos = {
      x: lastStep.x + direction.x * (reactionDistance / numReactionSteps),
      z: lastStep.z + direction.y * (reactionDistance / numReactionSteps),
    };
    const newStep = { ...newPos, time: lastStep.time + timePerReactionStep };
    newBrakingSteps.push(newStep);
    lastStep = newStep;
  }
  let currentSpeed_mps = initialSpeed_mps;
  while (currentSpeed_mps > 0) {
    const v_final_sq =
      currentSpeed_mps * currentSpeed_mps -
      2 * brakeAccel_mps2 * distancePerStep;
    const v_final = v_final_sq > 0 ? Math.sqrt(v_final_sq) : 0;
    const avgSpeed = (currentSpeed_mps + v_final) / 2;
    if (avgSpeed <= 0) break;
    const timeForStep = distancePerStep / avgSpeed;
    const newPos = {
      x: lastStep.x + direction.x * distancePerStep,
      z: lastStep.z + direction.y * distancePerStep,
    };
    const newStep = {
      ...newPos,
      time: lastStep.time + timeForStep,
      speed: (v_final * 3600) / 1000,
    };
    newBrakingSteps.push(newStep);
    lastStep = newStep;
    currentSpeed_mps = v_final;
  }
  if (newBrakingSteps.length > 0) {
    newBrakingSteps[newBrakingSteps.length - 1].isFinalStop = true;
    newBrakingSteps[newBrakingSteps.length - 1].speed = 0;
  }
  return newBrakingSteps;
}

function preShowTrajectory() {
  let tempPoints = new Map();
  let collisions = [];
  let stepsForPrediction =
    originalCarSteps.length > 0 ? [...originalCarSteps] : [...car.steps];
  if (originalCarSteps.length === 0)
    stepsForPrediction = car.steps.map((step) => ({ ...step }));

  for (let step = 0; step < stepsForPrediction.length; step++) {
    const marker = showTrajectory(car, step, car.color);
    stepsForPrediction[step].maker = marker;
    setTrajectoryMaps(tempPoints, marker, step);
  }

  for (let ped of peds) {
    let isCollisionDetectedForPed = false;
    for (let step = 0; step < ped.steps.length; step++) {
      const marker = showTrajectory(ped, step, ped.color);
      ped.steps[step].maker = marker;
      setTrajectoryMaps(tempPoints, marker, step);
    }

    for (let [timeKey, pointInfo] of tempPoints) {
      if (pointInfo.pedObjs.length > 0) {
        pointInfo.pedObjs.forEach((pedObj) => {
          if (pedObj.maker.obj.name === ped.name) {
            if (pedObj.collisionTime && !ped.collisionTime) {
              const time = parseFloat(pedObj.collisionTime).toFixed(1);
              ped.collisionTime = time;
              collisions.push({
                pedName: ped.name,
                time: time,
                type: "警示區", // 標記類型
                pedObj: pedObj,
                carObj: pointInfo.carObj,
              });
              isCollisionDetectedForPed = true;
            }
            if (pedObj.physicalCollisionTime && !ped.physicalCollisionTime) {
              const time = parseFloat(pedObj.physicalCollisionTime).toFixed(1);
              ped.physicalCollisionTime = time;
              collisions.push({
                pedName: ped.name,
                time: time,
                type: "物理碰撞", // 標記類型
                pedObj: pedObj,
                carObj: pointInfo.carObj,
              });
              isCollisionDetectedForPed = true;
            }
          }
        });
      }
    }

    if (!isCollisionDetectedForPed) {
      delete ped.collisionTime;
      delete ped.physicalCollisionTime;
    }
  }

  if (collisions.length > 0) {
    collisions.sort((a, b) => a.time - b.time);
    const firstCollision = collisions[0];
    const timeToCollision = parseFloat(firstCollision.time);

    textElement.innerHTML = `預測約 ${timeToCollision} 秒後，${firstCollision.pedName} 將發生 <strong style="color: red;">[${firstCollision.type}]</strong>！`;

    const collisionPed = firstCollision.pedObj;
    const pedBoxGeo = new THREE.BoxGeometry(
      collisionPed.maker.obj.entitySize.length,
      0.02,
      collisionPed.maker.obj.entitySize.width
    );
    const pedBoxMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      opacity: 0.4,
      transparent: true,
    });
    const pedBox = new THREE.Mesh(pedBoxGeo, pedBoxMat);
    pedBox.position.set(
      collisionPed.maker.position.x,
      0,
      collisionPed.maker.position.z
    );
    scene.add(pedBox);
    makerTemps.push(pedBox);
  } else {
    textElement.innerHTML = "無碰撞";
  }
}

preShowTrajectory();

function createPlayObjects() {
  carBodyPlaceholder = new THREE.Mesh(
    new THREE.BoxGeometry(car.entitySize.width, 0.2, car.entitySize.length), // 修正：交換寬度和長度，使長邊沿 Z 軸
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      opacity: 0.3,
      transparent: true,
    })
  );
  carBodyPlaceholder.name = "carBodyPlaceholder";
  scene.add(carBodyPlaceholder);

  if (car.model) {
    carModel = car.model.clone();
    carModel.name = "carModel";
    carModel.scale.set(0.02, 0.01, 0.02);
    scene.add(carModel);
  }

  carEllipse = new THREE.Mesh(
    new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0x0000ff,
      transparent: true,
      opacity: 0.2,
    })
  );
  carEllipse.name = "collisionEllipse";
  scene.add(carEllipse);

  pedsPlayObjects = peds.map((ped) => {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(ped.entitySize.length, 0.01, ped.entitySize.width),
      new THREE.MeshBasicMaterial({
        color: 0xff0000,
        opacity: 0.5,
        transparent: true,
      })
    );
    box.name = ped.name;
    scene.add(box);

    if (ped.model) {
      let pedModel = ped.model.clone();
      pedModel.name = "pedModel";
      pedModel.scale.set(0.015, 0.015, 0.015);
      pedModel.rotation.z = -Math.PI / 2;
      pedModel.rotation.x = -Math.PI / 2;
      pedsPlayModels.push(pedModel);
      scene.add(pedModel);
    }
    return box;
  });
}

function removePlayObjects() {
  if (carModel) scene.remove(carModel);
  if (carBodyPlaceholder) scene.remove(carBodyPlaceholder);
  if (carEllipse) scene.remove(carEllipse);
  pedsPlayObjects.forEach((obj) => scene.remove(obj));
  pedsPlayModels.forEach((obj) => scene.remove(obj));
  carModel = null;
  carBodyPlaceholder = null;
  carEllipse = null;
  pedsPlayObjects = [];
  pedsPlayModels = [];
}

function playDisabledButton() {
  document.querySelector("#start").disabled = true;
  document.querySelector("#resetStep").disabled = true;
  document.querySelector("#loading-modal").disabled = true;
}

function playEnabledButton() {
  document.querySelector("#start").disabled = false;
  document.querySelector("#resetStep").disabled = false;
  document.querySelector("#loading-modal").disabled = false;
}

function play() {
  elapsedTime = 0;
  isBrakingActive = false;
  isPlayCollision = false;

  if (originalCarSteps.length > 0) {
    car.steps = originalCarSteps.map((step) => ({ ...step }));
  } else {
    originalCarSteps = car.steps.map((step) => ({ ...step }));
  }

  peds.forEach((p) => {
    p.isWarned = false;
  });

  removePlayObjects();
  createPlayObjects();

  if (cameraMode === "FPP") setFPP();
  else setTPP();

  startTime = performance.now();
  isPlaying = true;
  playDisabledButton();
}

function setObjectColor(object, color) {
  if (!object) return;
  object.traverse((child) => {
    if (child.isMesh) {
      if (child.material) {
        child.material = child.material.clone();
        child.material.color.set(color);
      }
    }
  });
}

function animate(time) {
  animateId = requestAnimationFrame(animate);
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (isPlaying && !isPlayCollision) {
    elapsedTime = performance.now() - startTime;
    const elapsedSeconds = elapsedTime / 1000;
    secElement.innerHTML = elapsedSeconds.toFixed(1);

    const carCurrentStepIndex = car.steps.findIndex(
      (step) => step.time > elapsedSeconds
    );
    let tempStepNum =
      carCurrentStepIndex !== -1
        ? Math.max(0, carCurrentStepIndex - 1)
        : car.steps.length - 1;
    const carStep = car.steps[tempStepNum];
    const nextStep = car.steps[carCurrentStepIndex] || carStep;

    let carAngle = 0;
    if (nextStep && carStep) {
      const dx = nextStep.x - carStep.x;
      const dz = nextStep.z - carStep.z;
      if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
        carAngle = Math.atan2(dx, dz); // 修正：使用正確的參數順序
      }
    }

    if (carStep) {
      if (carBodyPlaceholder) {
        carBodyPlaceholder.position.set(carStep.x, 0.1, carStep.z);
        carBodyPlaceholder.rotation.y = carAngle;
      }
      if (carModel) {
        carModel.position.set(carStep.x, 0.1, carStep.z);
        carModel.rotation.y = carAngle + Math.PI / 2; // 修正：補償模型本身的朝向
      }
      if (carEllipse) {
        carEllipse.position.set(carStep.x, 0.01, carStep.z);
        carEllipse.rotation.y = carAngle;
        carEllipse.scale.set(
          car.collistionScope.width / 2,
          1,
          car.collistionScope.length / 2
        );
      }
      if (carStep.speed !== undefined) updateSpeed(carStep.speed.toFixed(0));

      const visualVehicle = carModel || carBodyPlaceholder;
      if (cameraMode === "FPP" && car.steps.length - 1 != tempStepNum) {
        camera.position.set(carStep.x, 2, carStep.z);
        if (nextStep) {
          camera.lookAt(nextStep.x, 2, nextStep.z);
        }
      }
    }

    peds.forEach((ped, index) => {
      const pedCurrentStepIndex = ped.steps.findIndex(
        (step) => step.time > elapsedSeconds
      );
      const pedStep =
        ped.steps[
          pedCurrentStepIndex !== -1
            ? Math.max(0, pedCurrentStepIndex - 1)
            : ped.steps.length - 1
        ];
      if (pedStep && pedsPlayObjects[index]) {
        pedsPlayObjects[index].position.set(pedStep.x, 0.01, pedStep.z);
        if (pedsPlayModels[index]) {
          pedsPlayModels[index].position.set(pedStep.x, 0.01, pedStep.z);
        }
      }
    });

    let minTtc = Infinity;
    let isInWarningZone = false;
    const logicVehicle = carBodyPlaceholder;

    peds.forEach((ped, index) => {
      const pedBox = pedsPlayObjects[index];
      if (!pedBox || !logicVehicle) return;

      if (
        checkPhysicalCollision(
          logicVehicle.position,
          car.entitySize,
          carAngle,
          pedBox.position,
          ped.entitySize
        )
      ) {
        isPlayCollision = true;
        warningElement.innerHTML = `<div class="position-absolute top-0 start-50 translate-middle-x alert alert-danger centered-alert display-4" role="alert">碰撞發生！</div>`;
        setObjectColor(carModel, 0xff0000);
        setObjectColor(carBodyPlaceholder, 0xff0000);
        isPlaying = false;
        playEnabledButton();
        return;
      }

      if (
        checkCollision(
          car,
          logicVehicle.position,
          pedBox.position,
          ped.entitySize,
          carAngle
        )
      ) {
        isInWarningZone = true;
        if (!ped.isWarned) ped.isWarned = true;
      }

      // Use the earliest of the two possible collision times for TTC
      let effectiveCollisionTime = ped.physicalCollisionTime;

      if (effectiveCollisionTime < Infinity) {
        let timeToCollision = effectiveCollisionTime - elapsedSeconds;
        if (timeToCollision < minTtc) {
          minTtc = timeToCollision;
        }
      }
    });

    if (shouldWarn(minTtc, car) && !isBrakingActive) {
      isBrakingActive = true;
      brakeIndicator.style.display = "block";
      warningElement.classList.add("blink");

      const currentCarStepIdx = car.steps.findIndex(
        (step) => step.time > elapsedSeconds
      );
      const newBrakingSteps = simulateBrakingSteps(
        car,
        currentCarStepIdx > 0 ? currentCarStepIdx - 1 : 0,
        config.params.t_reaction,
        config.params.a_brake
      );

      car.steps.splice(
        currentCarStepIdx,
        car.steps.length - currentCarStepIdx,
        ...newBrakingSteps
      );
    }

    let finalWarningMessage = "";
    let finalWarningMessageClass = "";
    if (isPlayCollision) return;
    if (carStep && carStep.isFinalStop) {
      finalWarningMessage = "✅ 成功避免碰撞";
      finalWarningMessageClass = "alert-success";
      warningElement.classList.remove("blink");
      brakeIndicator.style.display = "none";
      speedElement.value = 0;
      updateSpeed(0);
      isPlaying = false;
      playEnabledButton();
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance("煞車成功");
      utterance.volume = 0.1;
      // 取消所有正在朗讀或排隊中的語音
      window.speechSynthesis.speak(utterance);
    } else if (isInWarningZone) {
      finalWarningMessage = "危險：已進入預警範圍！";
      finalWarningMessageClass = "alert-warning";
      audio = new Audio("https://www.soundjay.com/buttons/beep-01a.mp3");
      audio.volume = 0.01;
      audio.play();
      const utterance = new SpeechSynthesisUtterance("請注意前方行人");
      utterance.volume = 0.1;
      window.speechSynthesis.speak(utterance);
    } else if (isBrakingActive) {
      finalWarningMessage = "煞車啟動！";
      finalWarningMessageClass = "alert-danger";
    } else if (minTtc < Infinity) {
      finalWarningMessage = `預計 ${minTtc.toFixed(1)} 秒後進入警示區`;
      finalWarningMessageClass = "alert-info";
    }
    if (finalWarningMessage.trim().length !== 0) {
      warningElement.innerHTML = `<div class="position-absolute top-0 start-50 translate-middle-x alert ${finalWarningMessageClass} centered-alert display-4" role="alert">${finalWarningMessage}</div>`;
    }
    if (minTtc < Infinity) {
      const warningThreshold =
        config.params.t_reaction +
        (car.speed * 1000) / 3600 / config.params.a_brake;

      textElement.innerHTML = `t<sub>entry</sub> = ${
        minTtc.toFixed(1) < 0 ? 0 : minTtc.toFixed(1)
      }s, t<sub>警示</sub> = ${warningThreshold.toFixed(1)}s`;
    }
  }

  renderer.render(scene, camera);
}
animate(performance.now());

function clearMaker() {
  makerTemps.forEach((maker) => scene.remove(maker));
  makerTemps = [];
  removePlayObjects();
  if (cameraMode.toUpperCase() === "FPP") setFPP();
  else setTPP();
}
document.querySelector("#perspective").addEventListener("change", (e) => {
  cameraMode = e.target.checked ? "TPP" : "FPP";
  if (isPlaying) {
    if (cameraMode === "TPP") setTPP();
  } else {
    if (cameraMode === "FPP") setFPP();
    else setTPP();
  }
});
function restart() {
  isPlaying = false;
  playEnabledButton();
  isBrakingActive = false;
  startTime = null;
  warningElement.innerHTML = "";
  warningElement.classList.remove("blink");
  brakeIndicator.style.display = "none";
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }

  window.speechSynthesis.cancel();

  peds.forEach((p) => {
    p.isWarned = false;
    delete p.collisionTime;
    delete p.physicalCollisionTime;
  });

  if (originalCarSteps.length > 0)
    car.steps = originalCarSteps.map((step) => ({ ...step }));

  updateSpeed(car.speed);
  speedElement.value = car.speed;
  clearMaker();
  preShowTrajectory();
}
document.querySelector("#restart").addEventListener("click", restart);
document.querySelector("#start").addEventListener("click", () => {
  restart();
  play();
});
document.querySelector("#speed").addEventListener("change", (e) => {
  car.speed = parseInt(e.target.value);
  updateSpeed(car.speed);
  originalCarSteps = [];
  clearMaker();
  preShowTrajectory();
});
document.querySelector("#resetStep").addEventListener("click", () => {
  ped1.resetSteps();
  clearMaker();
  preShowTrajectory();
});
function updatePedestrianPathFromPanel() {
  ped1.startPoint = {
    x: parseFloat(document.getElementById("startX_panel").value),
    z: parseFloat(document.getElementById("startZ_panel").value),
  };
  ped1.endPoint = {
    x: parseFloat(document.getElementById("endX_panel").value),
    z: parseFloat(document.getElementById("endZ_panel").value),
  };
  ped1.resetSteps();
  clearMaker();
  preShowTrajectory();
}

document.getElementById("loading-modal").addEventListener("click", () => {
  ped1.modelFun = loadModelOBJ("person");
  car.modelFun = loadModelOBJ("car");
});
document
  .getElementById("pedestrian-settings-panel")
  .addEventListener("input", updatePedestrianPathFromPanel);
