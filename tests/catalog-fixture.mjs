// Explicit test-only controlled data. Production never imports this fixture.
export const provider={async search({category}={}){
 const records=[
 {id:'demo-kopernik',name:'Kopernik',category:'event',district:'Śródmieście',districts:['Śródmieście'],lat:52.2418,lng:21.0287,description:'Nauka'},
 {id:'demo-zacheta',name:'Zachęta',category:'event',district:'Śródmieście',districts:['Śródmieście'],lat:52.239,lng:21.011,description:'Sztuka'}];
 return records.filter(p=>!category||category===p.category);
}};
