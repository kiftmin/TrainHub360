import { Router, type IRouter } from "express";
import healthRouter from "./health";
import trainhubRouter from "./trainhub";

const router: IRouter = Router();

router.use(healthRouter);
router.use(trainhubRouter);

export default router;
