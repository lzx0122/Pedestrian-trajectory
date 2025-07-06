import { calcSteps } from "./PTlib.js";
import { config } from "./config.js";

export class obj {
  constructor({
    name,
    color,
    speed,
    steps,
    startPoint,
    endPoint,
    entitySize,
    modelFun,
  }) {
    this.name = name;
    this.color = color;
    this.speed = speed;
    this.steps = steps || [];
    this.startPoint = startPoint;
    this.endPoint = endPoint;
    this.entitySize = entitySize;
    this.modelFun = modelFun;
    this.model = null;
    this.isWarned = false;

    // 初始化時就計算 collistionScope
    const speed_mps = (this.speed * 1000) / 3600;
    this.collistionScope = {
      length:
        this.entitySize.length + speed_mps * config.params.t_safety,
      width: this.entitySize.width + config.params.m * 2,
    };

    // 如果提供了起點和終點，則計算路徑
    if (this.startPoint && this.endPoint) {
      this.resetSteps();
    }
  }

  resetSteps() {
    // 重新計算 collistionScope 以應對速度變化
    const speed_mps = (this.speed * 1000) / 3600;
    this.collistionScope = {
      length:
        this.entitySize.length + speed_mps * config.params.t_safety,
      width: this.entitySize.width + config.params.m * 2,
    };

    if (this.startPoint && this.endPoint) {
      this.steps = calcSteps({
        startPoint: this.startPoint,
        endPoint: this.endPoint,
        speed: this.speed,
        isRandom: false, // 假設 obj 類別生成的路徑都不是隨機的
      });
    }
  }
}