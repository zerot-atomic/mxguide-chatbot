import { verifiedRecommendation } from '../src/chat/verified-recommendation';
it.each([
 [0,'0.00'],[0.40195408529000004,'0.40'],[0.004,'0.00'],[1.999,'2.00'],[120.1251,'120.13'],[1234.56789,'1234.57'],
])('reply formatea %s km sin modificar distanceKm, objetos o IDs', (distanceKm,formatted)=>{
 const place={id:'00000000-0000-4000-8000-000000000001',name:'Parque de ejemplo',category:'Natural',state:'',description:'',distanceKm};
 const result=verifiedRecommendation(JSON.stringify({placeIds:[place.id]}),{status:'found',mode:'nearby',places:[place]});
 expect(result.reply).toContain(`a ${formatted} km`);
 expect(result.places[0]).toBe(place);expect(result.places[0].distanceKm).toBe(distanceKm);
});
