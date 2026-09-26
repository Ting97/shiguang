/// <reference types="@tarojs/taro" />

declare module "*.png";
declare module "*.gif";
declare module "*.jpg";
declare module "*.jpeg";
declare module "*.svg";
declare module "*.css";
declare module "*.less";
declare module "*.scss";
declare module "*.sass";
declare module "*.styl";

declare namespace NodeJS {
  interface ProcessEnv {
    /** API 基址（config/index.ts defineConstants 注入；小程序无同域概念，必配） */
    TARO_APP_API_BASE: string;
  }
}

/** defineConstants 注入的全局常量（构建期字符串替换） */
declare const TARO_APP_API_BASE: string;
