export let config = {
  FPS: 1 / 60,
  distancePerStep: 0.1,
  stepDistance: 0.1,
  params: {
    t_safety: 3.5, // 系統反應 + 預測誤差緩衝 (秒)
    w_car: 1.75, // Altis 車寬 (公尺)
    m: 0.75, // 側向安全緩衝 (公尺)
    t_reaction: 1.5, // 人類或系統平均反應時間 (秒)
    a_brake: 8, // 中等乾燥路面煞車加速度 (m/s^2)
  },
};
//1
