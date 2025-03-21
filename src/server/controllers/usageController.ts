import * as usageService from '@server/services/usageService';
import { UsageData } from '@server/services/usageService';
import { AuthenticatedRouteHandler } from '@server/types';

export interface UsageResponse {
  usage: UsageData;
}

export const getUsage: AuthenticatedRouteHandler = async (req, res) => {
  const usage = await usageService.getUsage(req.user.id);
  res.json({
    usage,
  });
};
