const priceGuideService = require('../services/price-guide.service');

async function guide(req, res, next) {
  try {
    const { serviceType, postcode, estimatedHours } = req.body;
    res.status(200).json(await priceGuideService.getGuide({ serviceTypeId: serviceType, area: postcode, estimatedHours }));
  } catch (err) {
    next(err);
  }
}

module.exports = { guide };
