import { exp } from "three/tsl";
import { calcSteps } from "./PTlib";
import { config } from "./config";

export class obj {
  name = "";
  steps = [];
  color = 0x000000;
  _entitySize = { length: 1, width: 1 };
  collistionScope = { length: 1, width: 1 };
  _speed = 10;
  startPoint;
  endPoint;
  model = null;

  constructor({ name, color, steps, startPoint, endPoint, speed, entitySize }) {
    this.name = name;
    this.color = color;
    this.startPoint = startPoint;
    this.endPoint = endPoint;
    this._entitySize = entitySize;
    this.speed = speed;
    this.steps =
      steps ||
      calcSteps({ startPoint, endPoint, speed, isRandom: name != "car" });
  }

  resetSteps() {
    let temp = calcSteps({
      startPoint: this.startPoint,
      endPoint: this.endPoint,
      speed: this.speed,
      isRandom: this.name != "car",
    });
    this.steps = temp;
  }

  setCollistionScope() {
    if (this.name === "car") {
      const v_mps = (this._speed * 1000) / 3600;
      const t_warning =
        config.params.t_reaction + v_mps / config.params.a_brake;
      const semiMajorAxis = v_mps * t_warning;
      const semiMinorAxis = config.params.w_car + 2 * config.params.m;
      this.collistionScope = {
        length: semiMajorAxis,
        width: semiMinorAxis,
      };
    } else {
      this.collistionScope = {
        length: this._entitySize.length,
        width: this._entitySize.width,
      };
    }
  }

  /**
   * @param {{ length: number; width: number; }} value
   */
  set entitySize(value) {
    this._entitySize = value;
    this.setCollistionScope();
  }

  get entitySize() {
    return this._entitySize;
  }

  /**
   * @param {any} value
   */
  set speed(value) {
    this._speed = value;
    this.steps = calcSteps({
      startPoint: this.startPoint,
      endPoint: this.endPoint,
      speed: value,
      isRandom: this.name != "car",
    });
    this.setCollistionScope();
  }
  get speed() {
    return this._speed;
  }

  /**
   * @param {Promise<any>} v
   */
  set modelFun(v) {
    if (v) {
      v.then((model) => {
        this.model = model;
      });
    }
  }
}
